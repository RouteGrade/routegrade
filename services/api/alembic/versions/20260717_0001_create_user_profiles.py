"""Create public.user_profiles.

Revision ID: 0001_create_user_profiles
Revises:
Create Date: 2026-07-17

RouteGrade MVP 2: creates the application profile table that mirrors each
Supabase-managed identity in `auth.users`.

Notes:
- The FK to auth.users lives at the SQL level (Supabase manages that schema; we
  do not model it in SQLAlchemy).
- Row Level Security is enabled but no browser-facing policies are added — all
  reads and writes go through the FastAPI service using the trusted database
  role.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PgUUID

revision: str = "0001_create_user_profiles"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_profiles",
        sa.Column("user_id", PgUUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("avatar_url", sa.Text(), nullable=True),
        sa.Column("auth_provider", sa.Text(), nullable=False),
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
            name="user_profiles_user_id_fkey",
            ondelete="CASCADE",
        ),
        schema="public",
    )

    # Row Level Security: enabled, no policies. The FastAPI service uses a
    # trusted DB role (bypass RLS at the role level) and dbt uses a read-only
    # analytics role — the browser never talks to this table directly.
    op.execute("ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("ALTER TABLE public.user_profiles DISABLE ROW LEVEL SECURITY")
    op.drop_table("user_profiles", schema="public")
