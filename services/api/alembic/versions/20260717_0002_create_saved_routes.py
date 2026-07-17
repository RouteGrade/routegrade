"""Create public.saved_routes.

Revision ID: 0002_create_saved_routes
Revises: 0001_create_user_profiles
Create Date: 2026-07-17

RouteGrade MVP 3: user-saved routes.

Notes:
- Geometry is GeoJSON in JSONB (Phase 0 decision: defer PostGIS until spatial
  queries are needed).
- Unlike user_profiles (RLS on, no policies), saved_routes gets owner-only
  policies because it may be exposed through PostgREST later. The FastAPI
  trusted role bypasses RLS at the role level, so the API is unaffected.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision: str = "0002_create_saved_routes"
down_revision: Union[str, Sequence[str], None] = "0001_create_user_profiles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_routes",
        sa.Column("id", PgUUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", PgUUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("starting_address", sa.Text(), nullable=True),
        sa.Column("distance_km", sa.Numeric(5, 2), nullable=False),
        sa.Column("preference", sa.Text(), nullable=False),
        sa.Column("geometry", JSONB(), nullable=False),
        sa.Column("elevation_gain_m", sa.Numeric(6, 1), nullable=False),
        sa.Column("score", sa.Numeric(4, 1), nullable=False),
        sa.Column("grade", sa.Text(), nullable=False),
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
            name="saved_routes_user_id_fkey",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("char_length(name) BETWEEN 1 AND 120", name="saved_routes_name_len"),
        sa.CheckConstraint(
            "preference IN ('quiet', 'flat', 'scenic')", name="saved_routes_preference_allowed"
        ),
        sa.CheckConstraint(
            "grade IN ('A', 'B', 'C', 'D')", name="saved_routes_grade_allowed"
        ),
        sa.CheckConstraint("distance_km > 0", name="saved_routes_distance_positive"),
        sa.CheckConstraint(
            "elevation_gain_m >= 0", name="saved_routes_elevation_non_negative"
        ),
        schema="public",
    )
    op.create_index(
        "ix_saved_routes_user_id", "saved_routes", ["user_id"], schema="public"
    )

    # Owner-only RLS. The browser may reach this table via PostgREST later, so
    # unlike user_profiles we install real policies now.
    op.execute("ALTER TABLE public.saved_routes ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY saved_routes_select_own ON public.saved_routes
            FOR SELECT USING (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY saved_routes_insert_own ON public.saved_routes
            FOR INSERT WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY saved_routes_update_own ON public.saved_routes
            FOR UPDATE USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id)
        """
    )
    op.execute(
        """
        CREATE POLICY saved_routes_delete_own ON public.saved_routes
            FOR DELETE USING (auth.uid() = user_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS saved_routes_delete_own ON public.saved_routes")
    op.execute("DROP POLICY IF EXISTS saved_routes_update_own ON public.saved_routes")
    op.execute("DROP POLICY IF EXISTS saved_routes_insert_own ON public.saved_routes")
    op.execute("DROP POLICY IF EXISTS saved_routes_select_own ON public.saved_routes")
    op.execute("ALTER TABLE public.saved_routes DISABLE ROW LEVEL SECURITY")
    op.drop_index("ix_saved_routes_user_id", table_name="saved_routes", schema="public")
    op.drop_table("saved_routes", schema="public")
