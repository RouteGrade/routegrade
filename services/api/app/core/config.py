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

    # Route planning providers (MVP 3). Defaults point at public, keyless
    # OSM-ecosystem endpoints so local dev works out of the box; production
    # should self-host OSRM and (optionally) Nominatim — see
    # docs/routing-setup.md for the Phase 0 decision record.
    geocoder_base_url: str = Field(
        default="https://nominatim.openstreetmap.org",
        description="Nominatim-compatible geocoding endpoint",
    )
    geocoder_user_agent: str = Field(
        default="RouteGrade/0.1 (routegrade-api)",
        description="User-Agent sent to the geocoder (required by Nominatim's usage policy)",
    )
    osrm_base_url: str = Field(
        default="https://router.project-osrm.org",
        description="OSRM HTTP API base URL",
    )
    osrm_profile: str = Field(
        default="foot",
        description=(
            "OSRM routing profile. Self-hosted OSRM should use `foot`; the public "
            "demo server only serves `driving`."
        ),
    )
    osrm_bike_base_url: str | None = Field(
        default=None,
        description=(
            "OSRM host serving a *bicycle* graph, used when a plan asks for a "
            "ride. A single osrm-routed process serves exactly one graph — the "
            "profile is baked in at osrm-extract time and the profile segment in "
            "the request path is decorative — so riding genuinely needs its own "
            "host, not a different profile against the running one. Unset means "
            "rides fall back to the running host and are NOT bike-routed; the "
            "plan response reports that via activity_routed=false."
        ),
    )
    elevation_base_url: str = Field(
        default="https://api.open-elevation.com",
        description="Open-Elevation-compatible elevation endpoint",
    )
    provider_timeout_seconds: float = Field(
        default=10.0,
        description="Per-request timeout for outbound provider HTTP calls",
    )
    route_plan_distance_tolerance: float = Field(
        default=0.10,
        description="Accepted relative deviation between requested and generated distance",
    )
    route_plan_rate_limit_per_minute: int = Field(
        default=10,
        description="Sustained per-IP requests/minute on /v1/routes/plan; 0 disables limiting",
    )
    route_plan_rate_limit_burst: int = Field(
        default=5,
        description="Extra burst headroom above the sustained rate",
    )
    rate_limit_use_postgres: bool = Field(
        default=True,
        description=(
            "Use the Postgres-backed rate limiter when DATABASE_URL is set and "
            "no Upstash creds are configured. Default true so production gets "
            "cross-instance limiting with zero founder action; tests/dev disable "
            "via env to keep the in-memory limiter and avoid a DB round-trip."
        ),
    )
    upstash_redis_rest_url: str | None = Field(
        default=None,
        description="Upstash Redis REST endpoint (opt-in; higher-throughput backend)",
    )
    upstash_redis_rest_token: str | None = Field(
        default=None,
        description="Upstash Redis REST auth token (paired with upstash_redis_rest_url)",
    )

    # Per-user rate limits on authenticated write endpoints. Both are keyed on
    # the authenticated user id, so multi-tenant abuse of a single IP does not
    # starve other users. Defaults are permissive enough for real UI flows
    # (a runner saving several routes in a burst) but strict enough that a
    # runaway script hits a wall well before it can DoS the DB.
    runs_rate_limit_per_minute: int = Field(
        default=60,
        description="Sustained per-user PUT /v1/users/me/runs/{id} per minute; 0 disables",
    )
    runs_rate_limit_burst: int = Field(
        default=60,
        description="Extra burst headroom (capacity = per_minute + burst)",
    )
    saved_routes_rate_limit_per_minute: int = Field(
        default=30,
        description="Sustained per-user PUT /v1/users/me/routes/{id} per minute; 0 disables",
    )
    saved_routes_rate_limit_burst: int = Field(
        default=30,
        description="Extra burst headroom (capacity = per_minute + burst)",
    )

    # Defense-in-depth cap on request body size. Pydantic already bounds array
    # lengths per endpoint, but an oversized payload is otherwise fully buffered
    # into memory before validation runs. 1 MiB comfortably fits the largest
    # valid body (a 5000-point coordinate trace is ~150 KB) while rejecting
    # multi-megabyte abuse up front with a 413.
    max_request_body_bytes: int = Field(
        default=1_048_576,
        ge=0,
        description="Reject request bodies larger than this many bytes (413); 0 disables",
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
