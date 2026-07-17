"""SQLAlchemy model for the RouteGrade application profile."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserProfile(Base):
    """Application-owned profile row, one per authenticated Supabase identity.

    The primary key `user_id` mirrors `auth.users.id` (managed by Supabase). We
    intentionally do not model a SQLAlchemy relationship to `auth.users` — that
    schema is owned by Supabase and RouteGrade only needs to store the pointer.
    """

    __tablename__ = "user_profiles"
    __table_args__ = {"schema": "public"}

    user_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
    )
    email: Mapped[str] = mapped_column(String, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    auth_provider: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
