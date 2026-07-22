"""SQLAlchemy model for post-run ratings (route-quality feedback)."""

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


class RunRating(Base):
    """A runner's feedback after completing a route.

    Captured on the run-summary screen: how the run actually felt and whether
    RouteGrade's grade matched reality. This is the raw signal the scoring
    calibration loop consumes later — it never feeds back automatically.

    `user_id` mirrors `auth.users.id` (FK owned by Supabase at the SQL level).
    `run_id` and `route_id` are loose pointers (NOT foreign keys), matching the
    `runs` Phase 0 decision: deleting a run or saved route never erases the
    feedback history the scoring team needs. Identity for idempotent upsert is
    the `(user_id, run_id)` pair — one rating per run per user.

    `graded_score` / `graded_grade` / `preference` snapshot what RouteGrade
    predicted at rating time, so calibration can compare felt-vs-predicted
    without re-deriving a possibly-changed score.
    """

    __tablename__ = "run_ratings"
    __table_args__ = {"schema": "public"}

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    run_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False, index=True)
    route_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True), nullable=True)
    # How the run felt overall, 1 (rough) .. 5 (loved it).
    overall: Mapped[int] = mapped_column(Integer, nullable=False)
    # Felt vs. our grade: "felt_better" | "as_expected" | "felt_worse" | None.
    grade_match: Mapped[str | None] = mapped_column(String, nullable=True)
    # Quick-tap descriptors from a validated allow-list (see schemas).
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
