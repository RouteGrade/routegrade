"""Add intersections_per_km to public.saved_routes.

Revision ID: 0006_add_saved_route_intersections
Revises: 0005_create_run_ratings
Create Date: 2026-07-22

RouteGrade MS6: persist intersection density on saved routes so the shareable
scorecard shows the real, accurate "crossings" reason when a saved route is
reopened, instead of defaulting to 0 ("Quiet — few crossings").

Notes:
- NULLABLE on purpose: legacy rows saved before this migration have no stored
  value. Downstream (scorecard reasons) treats NULL as UNKNOWN and omits the
  crossings pill rather than fabricating one.
- CHECK allows NULL or a non-negative value.
- Additive only — safe to apply on any environment.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_add_saved_route_intersections"
down_revision: Union[str, Sequence[str], None] = "0005_create_run_ratings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "saved_routes",
        sa.Column("intersections_per_km", sa.Numeric(5, 2), nullable=True),
        schema="public",
    )
    op.create_check_constraint(
        "saved_routes_intersections_non_negative",
        "saved_routes",
        "intersections_per_km IS NULL OR intersections_per_km >= 0",
        schema="public",
    )


def downgrade() -> None:
    op.drop_constraint(
        "saved_routes_intersections_non_negative",
        "saved_routes",
        schema="public",
        type_="check",
    )
    op.drop_column("saved_routes", "intersections_per_km", schema="public")
