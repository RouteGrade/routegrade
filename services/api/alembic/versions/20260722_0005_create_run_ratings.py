"""Create public.run_ratings.

Revision ID: 0005_create_run_ratings
Revises: 0004_create_rate_limit_buckets
Create Date: 2026-07-22

RouteGrade MS6 Phase A: post-run route-quality feedback. Runners rate how a run
felt and whether our grade matched reality; this raw signal feeds the scoring
calibration loop (never automatically).

Notes:
- `run_id` and `route_id` are loose pointers (no FK) so deleting a run or saved
  route never erases feedback history — same Phase 0 decision as `runs`.
- One rating per run per user, enforced by a UNIQUE (user_id, run_id).
- `graded_score` / `graded_grade` / `preference` snapshot the prediction at
  rating time so calibration compares felt-vs-predicted without re-deriving.
- `tags` is a JSONB array of allow-listed slugs (validated at the API boundary).
- Owner-only RLS, same shape as `runs` / `saved_routes`.
- Additive only — safe to apply on any environment.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision: str = "0005_create_run_ratings"
down_revision: Union[str, Sequence[str], None] = "0004_create_rate_limit_buckets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "run_ratings",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("run_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("route_id", PgUUID(as_uuid=True), nullable=True),
        sa.Column("overall", sa.Integer(), nullable=False),
        sa.Column("grade_match", sa.Text(), nullable=True),
        sa.Column("tags", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("graded_score", sa.Numeric(4, 1), nullable=True),
        sa.Column("graded_grade", sa.Text(), nullable=True),
        sa.Column("preference", sa.Text(), nullable=True),
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
            name="run_ratings_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("user_id", "run_id", name="run_ratings_user_run_uniq"),
        sa.CheckConstraint(
            "overall >= 1 AND overall <= 5", name="run_ratings_overall_range"
        ),
        sa.CheckConstraint(
            "grade_match IS NULL OR grade_match IN "
            "('felt_better', 'as_expected', 'felt_worse')",
            name="run_ratings_grade_match_enum",
        ),
        schema="public",
    )
    op.create_index("ix_run_ratings_user_id", "run_ratings", ["user_id"], schema="public")
    op.create_index("ix_run_ratings_run_id", "run_ratings", ["run_id"], schema="public")

    # Owner-only RLS, same policy shape as runs / saved_routes.
    op.execute("ALTER TABLE public.run_ratings ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY run_ratings_select_own ON public.run_ratings
            FOR SELECT USING (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY run_ratings_insert_own ON public.run_ratings
            FOR INSERT WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY run_ratings_update_own ON public.run_ratings
            FOR UPDATE USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY run_ratings_delete_own ON public.run_ratings
            FOR DELETE USING (auth.uid() = user_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS run_ratings_delete_own ON public.run_ratings")
    op.execute("DROP POLICY IF EXISTS run_ratings_update_own ON public.run_ratings")
    op.execute("DROP POLICY IF EXISTS run_ratings_insert_own ON public.run_ratings")
    op.execute("DROP POLICY IF EXISTS run_ratings_select_own ON public.run_ratings")
    op.execute("ALTER TABLE public.run_ratings DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_run_ratings_run_id", table_name="run_ratings", schema="public")
    op.drop_index("ix_run_ratings_user_id", table_name="run_ratings", schema="public")
    op.drop_table("run_ratings", schema="public")
