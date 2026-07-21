"""Create public.route_plans (planner cache).

Revision ID: 0005_create_route_plans_cache
Revises: 0004_create_rate_limit_buckets
Create Date: 2026-07-22

RouteGrade pre-launch requirement (see docs/routing-setup.md): identical
`(start, distance, preference)` requests should reuse a computed route instead
of fanning out to Nominatim + OSRM + Open-Elevation on every request.

Design notes:
- Cache key is a canonical string over bucketed coordinates + distance +
  preference. Buckets are computed in the application layer (see
  `app/services/plan_cache.py`) so the DB stays generic.
- Payload is the exact serialized `PlanResponse` JSON we'd otherwise compute.
  No PII is stored — the address text never lands here; only bucketed lat/lng.
- Application-owned table. RLS enabled with zero permissive policies (matches
  `rate_limit_buckets`). The FastAPI trusted role bypasses RLS at the role
  level, so the API reads/writes freely; PostgREST / anon roles see nothing.
- Expiration is lazy: readers check `expires_at > now()`. A follow-up sweep
  (TODO in `app/services/plan_cache.py`) can garbage-collect expired rows via
  a periodic Vercel Cron or a manual `DELETE ... WHERE expires_at < now()`.
- Additive only — safe to apply on any environment.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision: str = "0005_create_route_plans_cache"
down_revision: Union[str, Sequence[str], None] = "0004_create_rate_limit_buckets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "route_plans",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("payload_json", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "expires_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now() + interval '24 hours'"),
            nullable=False,
        ),
        sa.Column("hit_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_hit_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("key", name="route_plans_key_unique"),
        schema="public",
    )
    # `key` is UNIQUE and therefore already indexed; add an explicit expiry
    # index so an eventual GC sweep (see plan_cache TODO) can do
    # `WHERE expires_at < now()` without a seqscan.
    op.create_index(
        "ix_route_plans_expires_at",
        "route_plans",
        ["expires_at"],
        schema="public",
    )

    # RLS on with zero policies: application-owned. Matches rate_limit_buckets
    # and user_profiles.
    op.execute("ALTER TABLE public.route_plans ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE public.route_plans DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_route_plans_expires_at", table_name="route_plans", schema="public")
    op.drop_table("route_plans", schema="public")
