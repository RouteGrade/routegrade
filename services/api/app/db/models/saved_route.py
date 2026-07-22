"""SQLAlchemy model for user-saved routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import DateTime, Numeric, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

_GeometryJSON = JSON().with_variant(JSONB(), "postgresql")


class SavedRoute(Base):
    """A route a signed-in user chose to keep.

    `user_id` mirrors `auth.users.id`; the FK lives at the SQL level (Alembic)
    because Supabase owns that schema. Geometry is stored as GeoJSON in JSONB —
    the Phase 0 decision defers PostGIS until we need spatial queries.
    `JSON().with_variant` keeps SQLite-backed tests working.
    """

    __tablename__ = "saved_routes"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    starting_address: Mapped[str | None] = mapped_column(String, nullable=True)
    distance_km: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    preference: Mapped[str] = mapped_column(String, nullable=False)
    geometry: Mapped[dict[str, Any]] = mapped_column(_GeometryJSON, nullable=False)
    elevation_gain_m: Mapped[Decimal] = mapped_column(Numeric(6, 1), nullable=False)
    # Intersection density (maneuvers per km). Nullable: legacy rows saved
    # before this column existed have no value, which downstream treats as
    # UNKNOWN rather than a real "few crossings" signal.
    intersections_per_km: Mapped[Decimal | None] = mapped_column(
        Numeric(5, 2), nullable=True
    )
    score: Mapped[Decimal] = mapped_column(Numeric(4, 1), nullable=False)
    grade: Mapped[str] = mapped_column(String, nullable=False)
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
