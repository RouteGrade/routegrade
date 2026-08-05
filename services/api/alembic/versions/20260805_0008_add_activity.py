"""Add activity (run|ride) to public.runs and public.saved_routes.

Revision ID: 0008_add_activity
Revises: 0007_create_route_feedback
Create Date: 2026-08-05

Founder request 2026-08-05: biking alongside running. Slice 3 — history has to
be able to tell a ride from a run, or every downstream reading of it (headline
metric, personal bests, weekly totals) is quietly wrong for one of them.

Notes:
- NOT NULL with a server default of 'run'. Every existing row predates riding
  and genuinely was a run, so backfilling that value is a statement of fact
  rather than a guess. Postgres 11+ adds a defaulted NOT NULL column without
  rewriting the table, so this stays cheap on a live table.
- The server default is kept (not dropped after backfill) so an older API
  instance still writing INSERTs without the column keeps working during a
  rolling deploy.
- CHECK constrains the domain to the two values the Pydantic Literal allows, so
  the database rejects a third value even if something bypasses the API.
- Additive only. Nothing is dropped and no existing value changes, so this is
  safe to apply on any environment and reversible without data loss.
- Revision id kept short: alembic_version.version_num was VARCHAR(32) in
  production until 2026-07-28 (widened to 64 after '0006_add_saved_route_
  intersections' at 34 chars broke stamping). This one is 17.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_add_activity"
down_revision: Union[str, Sequence[str], None] = "0007_create_route_feedback"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("runs", "saved_routes")


def upgrade() -> None:
    for table in _TABLES:
        op.add_column(
            table,
            sa.Column(
                "activity",
                sa.String(length=16),
                nullable=False,
                server_default="run",
            ),
            schema="public",
        )
        op.create_check_constraint(
            f"{table}_activity_valid",
            table,
            "activity IN ('run', 'ride')",
            schema="public",
        )


def downgrade() -> None:
    for table in _TABLES:
        op.drop_constraint(
            f"{table}_activity_valid", table, schema="public", type_="check"
        )
        op.drop_column(table, "activity", schema="public")
