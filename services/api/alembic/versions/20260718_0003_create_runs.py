"""Create public.runs.

Revision ID: 0003_create_runs
Revises: 0002_create_saved_routes
Create Date: 2026-07-18

RouteGrade MVP 5: recorded runs (Nike-Run-Club-style tracking).

Notes:
- `route_id` is a loose pointer (no FK) so deleting a saved route keeps run
  history intact.
- GPS trace + splits are GeoJSON/JSON in JSONB, matching the saved_routes
  Phase 0 decision to defer PostGIS.
- Owner-only RLS policies, same shape as saved_routes.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision: str = "0003_create_runs"
down_revision: Union[str, Sequence[str], None] = "0002_create_saved_routes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("route_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("route_name", sa.Text(), nullable=True),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=False),
        sa.Column("distance_km", sa.Numeric(6, 3), nullable=False),
        sa.Column("avg_pace_s_per_km", sa.Integer(), nullable=True),
        sa.Column("splits", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("path", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["auth.users.id"],
            name="runs_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("duration_s > 0", name="runs_duration_positive"),
        sa.CheckConstraint("distance_km >= 0", name="runs_distance_non_negative"),
        sa.CheckConstraint(
            "avg_pace_s_per_km IS NULL OR avg_pace_s_per_km > 0",
            name="runs_pace_positive",
        ),
        schema="public",
    )
    op.create_index("ix_runs_user_id", "runs", ["user_id"], schema="public")

    # Owner-only RLS, same policy shape as saved_routes.
    op.execute("ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY runs_select_own ON public.runs
            FOR SELECT USING (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY runs_insert_own ON public.runs
            FOR INSERT WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY runs_update_own ON public.runs
            FOR UPDATE USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY runs_delete_own ON public.runs
            FOR DELETE USING (auth.uid() = user_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS runs_delete_own ON public.runs")
    op.execute("DROP POLICY IF EXISTS runs_update_own ON public.runs")
    op.execute("DROP POLICY IF EXISTS runs_insert_own ON public.runs")
    op.execute("DROP POLICY IF EXISTS runs_select_own ON public.runs")
    op.execute("ALTER TABLE public.runs DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_runs_user_id", table_name="runs", schema="public")
    op.drop_table("runs", schema="public")
