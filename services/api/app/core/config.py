"""Typed application settings loaded from environment variables."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """RouteGrade API runtime settings.

    All fields are required except where a default is explicitly given. The API
    fails fast at import-time (via `get_settings`) if any required setting is
    missing, so misconfiguration surfaces as a clear error rather than a runtime
    surprise later.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Database
    database_url: str = Field(
        ...,
        description="SQLAlchemy database URL, e.g. postgresql+psycopg://user:pw@host/db",
    )

    # Supabase / JWT verification
    supabase_url: str = Field(..., description="Base URL of the Supabase project")
    supabase_jwt_issuer: str = Field(
        ...,
        description="Exact `iss` claim expected on Supabase-issued JWTs",
    )
    supabase_jwks_url: str = Field(
        ...,
        description="JWKS endpoint used to verify Supabase JWT signatures",
    )
    supabase_jwt_audience: str = Field(
        default="authenticated",
        description="Expected `aud` claim on user tokens",
    )
    supabase_jwt_algorithms: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["RS256", "ES256"],
        description="Allowed JWT signing algorithms; symmetric algs are intentionally excluded",
    )

    # CORS
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"],
        description="Comma-separated list of allowed origins",
    )

    @field_validator("cors_origins", "supabase_jwt_algorithms", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""

    return Settings()  # type: ignore[call-arg]
