"""Create public.route_feedback.

Revision ID: 0007_create_route_feedback
Revises: 0006_add_saved_route_intersections
Create Date: 2026-07-24

RouteGrade MS6 Phase A: route-view grade feedback. Distinct from `run_ratings`
(post-run, "how did it feel") — this is captured at browse time on a saved
route's scorecard: does RouteGrade's grade match the runner's read of the
route? It is the most direct signal for the grade-quality calibration loop, and
answers the founder's standing "every route grades the same" concern with real
user labels on where the grade is off (and which direction).

Notes:
- `route_id` is a loose pointer (no FK) so deleting a saved route never erases
  the feedback history calibration needs — same Phase 0 decision as `runs` /
  `run_ratings`.
- One feedback row per route per user, enforced by UNIQUE (user_id, route_id);
  re-submitting overwrites via upsert.
- `verdict` is the core signal: accurate | too_generous | too_harsh.
- `graded_score` / `graded_grade` / `preference` snapshot the prediction at
  feedback time so calibration compares label-vs-predicted without re-deriving.
- `tags` is a JSONB array of allow-listed slugs (validated at the API boundary).
- Owner-only RLS, same shape as `runs` / `saved_routes` / `run_ratings`.
- Additive only — safe to apply on any environment.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision: str = "0007_create_route_feedback"
down_revision: Union[str, Sequence[str], None] = "0006_add_saved_route_intersections"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "route_feedback",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("route_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("verdict", sa.Text(), nullable=False),
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
            name="route_feedback_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("user_id", "route_id", name="route_feedback_user_route_uniq"),
        sa.CheckConstraint(
            "verdict IN ('accurate', 'too_generous', 'too_harsh')",
            name="route_feedback_verdict_enum",
        ),
        schema="public",
    )
    op.create_index(
        "ix_route_feedback_user_id", "route_feedback", ["user_id"], schema="public"
    )
    op.create_index(
        "ix_route_feedback_route_id", "route_feedback", ["route_id"], schema="public"
    )

    # Owner-only RLS, same policy shape as runs / saved_routes / run_ratings.
    op.execute("ALTER TABLE public.route_feedback ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY route_feedback_select_own ON public.route_feedback
            FOR SELECT USING (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY route_feedback_insert_own ON public.route_feedback
            FOR INSERT WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY route_feedback_update_own ON public.route_feedback
            FOR UPDATE USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY route_feedback_delete_own ON public.route_feedback
            FOR DELETE USING (auth.uid() = user_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS route_feedback_delete_own ON public.route_feedback")
    op.execute("DROP POLICY IF EXISTS route_feedback_update_own ON public.route_feedback")
    op.execute("DROP POLICY IF EXISTS route_feedback_insert_own ON public.route_feedback")
    op.execute("DROP POLICY IF EXISTS route_feedback_select_own ON public.route_feedback")
    op.execute("ALTER TABLE public.route_feedback DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_route_feedback_route_id", table_name="route_feedback", schema="public")
    op.drop_index("ix_route_feedback_user_id", table_name="route_feedback", schema="public")
    op.drop_table("route_feedback", schema="public")
