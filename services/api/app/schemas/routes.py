"""Pydantic schemas for route planning and saved routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Preference = Literal["quiet", "flat", "scenic"]


# Upper bound on positions in a LineString. The web recorder is
# distance-gated (run-tracker.tsx drops fixes closer than MIN_STEP_M = 2.5 m),
# so point count ≈ distance / 2.5 m: 100,000 positions covers a ~250 km trace,
# beyond any run the API otherwise accepts, while still rejecting
# multi-hundred-MB hostile geometry. At ~40 bytes per JSON position the cap
# bounds geometry at ~4 MB, in line with the platform's request-body limit;
# the JSON is still fully parsed before validation, so a proxy-level body
# limit remains the first line of defense. Note: this bound also applies to
# response models sharing this schema, so it must never be lowered below the
# largest geometry already persisted.
MAX_LINESTRING_COORDINATES = 100_000


class LineStringGeometry(BaseModel):
    """Minimal GeoJSON LineString — the only geometry RouteGrade stores.

    `coordinates` is bounded to `MAX_LINESTRING_COORDINATES` positions so
    user-supplied GPS traces cannot be used for payload-size abuse; see the
    constant's comment for the sizing rationale.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["LineString"]
    coordinates: list[list[float]] = Field(
        min_length=2, max_length=MAX_LINESTRING_COORDINATES
    )

    @field_validator("coordinates")
    @classmethod
    def _validate_positions(cls, v: list[list[float]]) -> list[list[float]]:
        for position in v:
            if len(position) != 2:
                raise ValueError("each position must be [longitude, latitude]")
            lng, lat = position
            if not (-180.0 <= lng <= 180.0 and -90.0 <= lat <= 90.0):
                raise ValueError("coordinates out of range")
        return v


class PlanRequest(BaseModel):
    """Body of POST /v1/routes/plan. Provide an address or explicit coordinates."""

    model_config = ConfigDict(extra="forbid")

    address: str | None = Field(default=None, min_length=1, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    distance_km: float = Field(ge=1, le=30)
    preference: Preference = "quiet"

    @model_validator(mode="after")
    def _require_start(self) -> "PlanRequest":
        has_coords = self.latitude is not None and self.longitude is not None
        if not has_coords and not (self.address and self.address.strip()):
            raise ValueError("provide either address or latitude+longitude")
        return self


class StartPoint(BaseModel):
    latitude: float
    longitude: float
    label: str


class PlannedRoute(BaseModel):
    """One scored candidate. `id` is the identity a later PUT save uses."""

    id: uuid.UUID
    name: str
    geometry: LineStringGeometry
    distance_km: float
    elevation_gain_m: float
    intersections_per_km: float
    sidewalk_coverage: float | None
    score: float
    grade: Literal["A", "B", "C", "D"]
    within_tolerance: bool
    provider: str


class PlanResponse(BaseModel):
    start: StartPoint
    requested_distance_km: float
    preference: Preference
    distance_tolerance: float
    routes: list[PlannedRoute]


class SavedRouteSave(BaseModel):
    """Body of PUT /v1/users/me/routes/:id — persists a planned candidate."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)
    starting_address: str | None = Field(default=None, max_length=300)
    distance_km: float = Field(gt=0, le=999.99)
    preference: Preference
    geometry: LineStringGeometry
    elevation_gain_m: float = Field(ge=0)
    score: float = Field(ge=0, le=100)
    grade: Literal["A", "B", "C", "D"]

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("name must not be blank")
        return stripped


class SavedRouteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    starting_address: str | None
    distance_km: float
    preference: Preference
    geometry: LineStringGeometry
    elevation_gain_m: float
    score: float
    grade: Literal["A", "B", "C", "D"]
    created_at: datetime
    updated_at: datetime


class SavedRouteEnvelope(BaseModel):
    route: SavedRouteRead
    created: bool = False


class SavedRouteList(BaseModel):
    routes: list[SavedRouteRead]
