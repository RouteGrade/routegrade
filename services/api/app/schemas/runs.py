"""Pydantic schemas for recorded runs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.routes import LineStringGeometry


class RunSplit(BaseModel):
    """One completed kilometer: which km it was and how long it took."""

    model_config = ConfigDict(extra="forbid")

    km: int = Field(ge=1, le=1000)
    duration_s: int = Field(gt=0, le=86_400)


class RunSave(BaseModel):
    """Body of PUT /v1/users/me/runs/:id — persists a completed run."""

    model_config = ConfigDict(extra="forbid")

    route_id: uuid.UUID | None = None
    route_name: str | None = Field(default=None, max_length=120)
    started_at: datetime
    duration_s: int = Field(gt=0, le=86_400)
    distance_km: float = Field(ge=0, le=999.999)
    avg_pace_s_per_km: int | None = Field(default=None, gt=0, le=86_400)
    splits: list[RunSplit] = Field(default_factory=list, max_length=1000)
    path: LineStringGeometry | None = None


class RunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    route_id: uuid.UUID | None
    route_name: str | None
    started_at: datetime
    duration_s: int
    distance_km: float
    avg_pace_s_per_km: int | None
    splits: list[RunSplit]
    path: LineStringGeometry | None
    created_at: datetime
    updated_at: datetime


class RunEnvelope(BaseModel):
    run: RunRead
    created: bool = False


class RunList(BaseModel):
    runs: list[RunRead]
