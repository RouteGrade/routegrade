"""Typed subset of Supabase JWT claims trusted by RouteGrade."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserMetadata(BaseModel):
    """Provider-supplied metadata; used only to seed the profile."""

    model_config = ConfigDict(extra="ignore")

    full_name: str | None = Field(default=None)
    name: str | None = Field(default=None)
    avatar_url: str | None = Field(default=None)
    picture: str | None = Field(default=None)


class AppMetadata(BaseModel):
    model_config = ConfigDict(extra="ignore")

    provider: str | None = Field(default=None)
    providers: list[str] = Field(default_factory=list)


class Claims(BaseModel):
    """The verified subset of a Supabase JWT that RouteGrade consumes."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    user_id: uuid.UUID
    email: EmailStr
    role: str
    issuer: str
    audience: str
    user_metadata: UserMetadata = Field(default_factory=UserMetadata)
    app_metadata: AppMetadata = Field(default_factory=AppMetadata)

    @property
    def provider(self) -> str:
        """Best-effort provider identifier for the profile row.

        Supabase populates `app_metadata.provider` on OAuth logins ("google") and
        uses "email" for magic-link sign-ins.
        """

        return self.app_metadata.provider or "email"

    @property
    def display_name(self) -> str | None:
        md = self.user_metadata
        return md.full_name or md.name

    @property
    def avatar_url(self) -> str | None:
        md = self.user_metadata
        return md.avatar_url or md.picture
