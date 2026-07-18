"""SQLAlchemy model for completed runs recorded by users."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, Integer, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

_JSONVariant = JSON().with_variant(JSONB(), "postgresql")


class Run(Base):
    """A completed run a signed-in user recorded.

    `user_id` mirrors `auth.users.id`; the FK lives at the SQL level (Alembic)
    because Supabase owns that schema. `route_id` is a loose pointer to the
    route the run followed — intentionally NOT a foreign key, so deleting a
    saved route never erases run history. The recorded GPS trace is GeoJSON in
    JSONB (same Phase 0 decision as saved_routes: defer PostGIS). Splits are a
    JSONB array of `{"km": 1, "duration_s": 342}` objects.
    """

    __tablename__ = "runs"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    route_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    route_name: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_s: Mapped[int] = mapped_column(Integer, nullable=False)
    distance_km: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    avg_pace_s_per_km: Mapped[int | None] = mapped_column(Integer, nullable=True)
    splits: Mapped[list[Any]] = mapped_column(_JSONVariant, nullable=False, default=list)
    path: Mapped[dict[str, Any] | None] = mapped_column(_JSONVariant, nullable=True)
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
