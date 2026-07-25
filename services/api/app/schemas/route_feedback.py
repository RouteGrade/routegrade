"""Pydantic schemas for route-view grade feedback.

Deliberately quick: a single required `verdict` (is the grade accurate, too
generous, or too harsh), plus optional quick-tap reason tags and an optional
short note. Tags are validated against a closed allow-list so the calibration
loop only ever sees known signals — never arbitrary free text in a field the
scoring team will aggregate.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.routes import Preference

Verdict = Literal["accurate", "too_generous", "too_harsh"]
Grade = Literal["A", "B", "C", "D"]

# Closed vocabulary of "why the grade felt off" reasons, kept in sync with the
# web UI. Slugs, not free text, so aggregation stays clean and no unbounded
# strings enter the calibration pipeline.
ALLOWED_TAGS: frozenset[str] = frozenset(
    {
        "too_many_crossings",
        "too_few_crossings",
        "hillier_than_graded",
        "flatter_than_graded",
        "busier_than_graded",
        "quieter_than_graded",
        "surface_worse",
        "surface_better",
        "distance_off",
        "not_scenic",
        "more_scenic",
    }
)

_MAX_TAGS = 6
_MAX_COMMENT = 280


class RouteFeedbackSave(BaseModel):
    """Body of PUT /v1/users/me/routes/{route_id}/feedback."""

    model_config = ConfigDict(extra="forbid")

    verdict: Verdict
    tags: list[str] = Field(default_factory=list, max_length=_MAX_TAGS)
    comment: str | None = Field(default=None, max_length=_MAX_COMMENT)
    # Prediction snapshot supplied by the client from the route being rated.
    # All optional so older clients still submit a verdict.
    graded_score: float | None = Field(default=None, ge=0, le=100)
    graded_grade: Grade | None = None
    preference: Preference | None = None

    @field_validator("tags")
    @classmethod
    def _validate_tags(cls, v: list[str]) -> list[str]:
        # De-duplicate while preserving order, and reject anything off-list.
        seen: set[str] = set()
        cleaned: list[str] = []
        for tag in v:
            slug = tag.strip().lower()
            if slug not in ALLOWED_TAGS:
                raise ValueError(f"unknown tag: {tag!r}")
            if slug not in seen:
                seen.add(slug)
                cleaned.append(slug)
        return cleaned

    @field_validator("comment")
    @classmethod
    def _strip_comment(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        return stripped or None


class RouteFeedbackRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    route_id: uuid.UUID
    verdict: Verdict
    tags: list[str]
    comment: str | None
    graded_score: float | None
    graded_grade: Grade | None
    preference: Preference | None
    created_at: datetime
    updated_at: datetime


class RouteFeedbackEnvelope(BaseModel):
    feedback: RouteFeedbackRead
    created: bool = False
