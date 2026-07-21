"""SQLAlchemy model for the planner cache (`public.route_plans`).

The cache is application-owned: RLS is enabled with no permissive policies, and
the FastAPI trusted role bypasses RLS at the role level. See migration
`0005_create_route_plans_cache` for the SQL definition and design rationale.

No PII lives here — `key` is derived from bucketed coordinates, distance, and
preference; addresses are resolved to lat/lng before the key is computed.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON

from app.db.base import Base

# JSONB in Postgres, plain JSON in SQLite (tests).
_PayloadJSON = JSON().with_variant(JSONB(), "postgresql")


class RoutePlanCache(Base):
    """A cached `PlanResponse` payload keyed on bucketed request parameters."""

    __tablename__ = "route_plans"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    key: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(_PayloadJSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_hit_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
