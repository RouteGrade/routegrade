"""Pydantic request/response schemas for the users API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserProfileRead(BaseModel):
    """Response shape for `/v1/users/me` endpoints."""

    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    email: EmailStr
    display_name: str | None
    avatar_url: str | None
    auth_provider: str
    created_at: datetime
    updated_at: datetime


class UserProfileEnvelope(BaseModel):
    user: UserProfileRead
    created: bool = False


class UserProfileUpdate(BaseModel):
    """Client-editable profile fields. Unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def _strip_and_validate(cls, v: str | None) -> str | None:
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            raise ValueError("display_name must not be blank")
        return stripped
