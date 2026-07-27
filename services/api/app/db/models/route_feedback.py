"""SQLAlchemy model for route-view grade feedback."""

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

_JSONVariant = JSON().with_variant(JSONB(), "postgresql")


class RouteFeedback(Base):
    """A runner's verdict on whether a saved route's grade is accurate.

    Captured at browse time on the route scorecard — distinct from `RunRating`,
    which is captured after a run. This is the most direct signal for the grade
    calibration loop: did our grade match the runner's read of the route, and if
    not, which way was it off? It never feeds back into scoring automatically.

    `user_id` mirrors `auth.users.id` (FK owned by Supabase at the SQL level).
    `route_id` is a loose pointer (NOT a foreign key), matching the `runs` /
    `run_ratings` Phase 0 decision: deleting a saved route never erases the
    feedback history calibration needs. Identity for idempotent upsert is the
    `(user_id, route_id)` pair — one verdict per route per user.

    `graded_score` / `graded_grade` / `preference` snapshot what RouteGrade
    predicted at feedback time, so calibration can compare label-vs-predicted
    without re-deriving a possibly-changed score.
    """

    __tablename__ = "route_feedback"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    route_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    # Core signal: "accurate" | "too_generous" | "too_harsh".
    verdict: Mapped[str] = mapped_column(String, nullable=False)
    # Quick-tap reasons from a validated allow-list (see schemas).
    tags: Mapped[list[Any]] = mapped_column(_JSONVariant, nullable=False, default=list)
    comment: Mapped[str | None] = mapped_column(String, nullable=True)
    # Snapshot of what RouteGrade predicted, for calibration joins.
    graded_score: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    graded_grade: Mapped[str | None] = mapped_column(String, nullable=True)
    preference: Mapped[str | None] = mapped_column(String, nullable=True)
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
