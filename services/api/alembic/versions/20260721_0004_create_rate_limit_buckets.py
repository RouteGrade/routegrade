"""Create public.rate_limit_buckets.

Revision ID: 0004_create_rate_limit_buckets
Revises: 0003_create_runs
Create Date: 2026-07-21

RouteGrade MVP 6 (prod fixes): cross-instance token-bucket state for the
Postgres-backed rate limiter. This lets the API rate-limit consistently across
every Vercel instance without provisioning any new vendor (we already pay for
Supabase Postgres via DATABASE_URL).

Notes:
- Application-owned table; the FastAPI trusted role reads/writes it directly.
- RLS is enabled with no permissive policies. The browser never touches this
  table; the trusted DB role bypasses RLS at the role level, matching
  user_profiles' shape.
- Additive only — safe to apply on any environment.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_create_rate_limit_buckets"
down_revision: Union[str, Sequence[str], None] = "0003_create_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_buckets",
        sa.Column("key", sa.Text(), primary_key=True, nullable=False),
        sa.Column("tokens", sa.Float(), nullable=False),
        sa.Column("last_refill_ms", sa.BigInteger(), nullable=False),
        sa.Column("capacity", sa.Float(), nullable=False),
        sa.Column("refill_rate", sa.Float(), nullable=False),
        schema="public",
    )
    # RLS on with zero policies: matches user_profiles. Application-owned.
    op.execute("ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE public.rate_limit_buckets DISABLE ROW LEVEL SECURITY")
    op.drop_table("rate_limit_buckets", schema="public")
