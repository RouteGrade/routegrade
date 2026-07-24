"""Pydantic schemas for route planning and saved routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Preference = Literal["quiet", "flat", "scenic"]


class LineStringGeometry(BaseModel):
    """Minimal GeoJSON LineString — the only geometry RouteGrade stores."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["LineString"]
    coordinates: list[list[float]] = Field(min_length=2)

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


class CustomRouteRequest(BaseModel):
    """Body of POST /v1/routes/custom — grade a user-drawn route.

    `coordinates` is the raw [lng, lat] trace the user drew; the server snaps it
    to the road network before scoring, so a rough finger drag is fine.
    """

    model_config = ConfigDict(extra="forbid")

    coordinates: list[list[float]] = Field(min_length=2, max_length=5000)
    preference: Preference = "quiet"
    name: str | None = Field(default=None, max_length=120)

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


def _valid_position(v: list[float]) -> list[float]:
    if len(v) != 2:
        raise ValueError("position must be [longitude, latitude]")
    lng, lat = v
    if not (-180.0 <= lng <= 180.0 and -90.0 <= lat <= 90.0):
        raise ValueError("coordinates out of range")
    return v


class NearestRequest(BaseModel):
    """Body of POST /v1/routes/nearest — snap a cursor point to the network."""

    model_config = ConfigDict(extra="forbid")

    point: list[float] = Field(min_length=2, max_length=2)

    @field_validator("point")
    @classmethod
    def _check(cls, v: list[float]) -> list[float]:
        return _valid_position(v)


class NearestResponse(BaseModel):
    snapped: list[float]


class SegmentRequest(BaseModel):
    """Body of POST /v1/routes/segment — route one drawn segment (a -> b)."""

    model_config = ConfigDict(extra="forbid")

    start: list[float] = Field(min_length=2, max_length=2)
    end: list[float] = Field(min_length=2, max_length=2)

    @field_validator("start", "end")
    @classmethod
    def _check(cls, v: list[float]) -> list[float]:
        return _valid_position(v)


class SegmentResponse(BaseModel):
    geometry: LineStringGeometry
    distance_km: float


class GeocodeRequest(BaseModel):
    """Body of POST /v1/geocode — resolve an address to a point."""

    model_config = ConfigDict(extra="forbid")

    address: str = Field(min_length=1, max_length=300)


class GeocodeResponse(BaseModel):
    latitude: float
    longitude: float
    label: str


class AlternativesRequest(BaseModel):
    """Body of POST /v1/routes/alternatives — route options between two points."""

    model_config = ConfigDict(extra="forbid")

    start: list[float] = Field(min_length=2, max_length=2)
    end: list[float] = Field(min_length=2, max_length=2)

    @field_validator("start", "end")
    @classmethod
    def _check(cls, v: list[float]) -> list[float]:
        return _valid_position(v)


class RouteOption(BaseModel):
    geometry: LineStringGeometry
    distance_km: float


class AlternativesResponse(BaseModel):
    routes: list[RouteOption]


class SnapRouteRequest(BaseModel):
    """Body of POST /v1/routes/snap — snap a drawn trace to roads (no scoring).

    Used for live assisted drawing: as the user draws, the raw trace is snapped
    onto the road network and the on-road geometry is returned for rendering.
    """

    model_config = ConfigDict(extra="forbid")

    coordinates: list[list[float]] = Field(min_length=2, max_length=5000)

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


class SnapRouteResponse(BaseModel):
    geometry: LineStringGeometry
    distance_km: float


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
    elevation_subscore: float
    intersection_subscore: float
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
    # Optional so older clients / free routes without the metric still save;
    # persisted so the scorecard can show the real crossings reason on reopen.
    intersections_per_km: float | None = Field(default=None, ge=0)
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
    intersections_per_km: float | None
    score: float
    grade: Literal["A", "B", "C", "D"]
    created_at: datetime
    updated_at: datetime


class SavedRouteEnvelope(BaseModel):
    route: SavedRouteRead
    created: bool = False


class SavedRouteList(BaseModel):
    routes: list[SavedRouteRead]
