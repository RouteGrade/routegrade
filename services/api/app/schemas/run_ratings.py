"""Pydantic schemas for post-run ratings (route-quality feedback).

The rating UX is deliberately quick: a 1-5 star "how did it feel", an optional
"did our grade match" chip, a handful of optional quick-tap tags, and an
optional short note. Everything except `overall` is optional so a rating is a
few taps. Tags are validated against a closed allow-list so the calibration
loop only ever sees known signals — never arbitrary free text in a field the
scoring team will aggregate.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.routes import Preference

GradeMatch = Literal["felt_better", "as_expected", "felt_worse"]
Grade = Literal["A", "B", "C", "D"]

# Closed vocabulary of quick-tap descriptors. Kept in sync with the web UI
# (apps/web/src/lib/scorecard.ts). Slugs, not free text, so aggregation stays
# clean and no unbounded strings enter the calibration pipeline.
ALLOWED_TAGS: frozenset[str] = frozenset(
    {
        "flat",
        "hilly",
        "quiet",
        "busy",
        "scenic",
        "well_lit",
        "poorly_lit",
        "good_surface",
        "bad_surface",
        "felt_safe",
        "felt_unsafe",
        "too_many_crossings",
        "got_lost",
        "great_views",
    }
)

_MAX_TAGS = 8
_MAX_COMMENT = 280


class RunRatingSave(BaseModel):
    """Body of PUT /v1/users/me/runs/{run_id}/rating."""

    model_config = ConfigDict(extra="forbid")

    overall: int = Field(ge=1, le=5)
    grade_match: GradeMatch | None = None
    tags: list[str] = Field(default_factory=list, max_length=_MAX_TAGS)
    comment: str | None = Field(default=None, max_length=_MAX_COMMENT)
    # Loose pointer + prediction snapshot, supplied by the client from the
    # route that was run. All optional: free runs have no planned route.
    route_id: uuid.UUID | None = None
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


class RunRatingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    run_id: uuid.UUID
    route_id: uuid.UUID | None
    overall: int
    grade_match: GradeMatch | None
    tags: list[str]
    comment: str | None
    graded_score: float | None
    graded_grade: Grade | None
    preference: Preference | None
    created_at: datetime
    updated_at: datetime


class RunRatingEnvelope(BaseModel):
    rating: RunRatingRead
    created: bool = False
