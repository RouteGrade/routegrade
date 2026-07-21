"""Per-user rate-limit dependencies for authenticated write endpoints.

Keyed on the authenticated user id (not the IP), so multi-tenant abuse on a
single IP does not starve other users, and legitimate users behind a shared
NAT are not collectively throttled.

Both limiters are built lazily via `get_limiter()` so setting the two Upstash
env vars is the sole switch from in-memory to shared Redis (see
`app/core/rate_limit.py`). Tests can override via `app.state`.
"""

from __future__ import annotations

import math
from functools import lru_cache

from fastapi import HTTPException, Request, status

from app.auth.dependencies import CurrentClaims
from app.core.config import get_settings
from app.core.rate_limit import RateLimiter, get_limiter


@lru_cache(maxsize=1)
def _default_runs_limiter() -> RateLimiter | None:
    settings = get_settings()
    if settings.runs_rate_limit_per_minute <= 0:
        return None
    return get_limiter(
        rate_per_minute=settings.runs_rate_limit_per_minute,
        capacity=settings.runs_rate_limit_per_minute + settings.runs_rate_limit_burst,
        upstash_url=settings.upstash_redis_rest_url,
        upstash_token=settings.upstash_redis_rest_token,
        key_prefix="rg:rl:runs:",
    )


@lru_cache(maxsize=1)
def _default_saved_routes_limiter() -> RateLimiter | None:
    settings = get_settings()
    if settings.saved_routes_rate_limit_per_minute <= 0:
        return None
    return get_limiter(
        rate_per_minute=settings.saved_routes_rate_limit_per_minute,
        capacity=settings.saved_routes_rate_limit_per_minute
        + settings.saved_routes_rate_limit_burst,
        upstash_url=settings.upstash_redis_rest_url,
        upstash_token=settings.upstash_redis_rest_token,
        key_prefix="rg:rl:saved_routes:",
    )


def _enforce(limiter: RateLimiter | None, user_key: str, message: str) -> None:
    if limiter is None:
        return
    allowed, retry_after = limiter.check(user_key)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "rate_limited", "message": message},
            headers={"Retry-After": str(max(1, math.ceil(retry_after)))},
        )


def enforce_runs_write_rate_limit(request: Request, claims: CurrentClaims) -> None:
    """429 when a user exceeds their runs-upsert budget.

    Tests override via `app.state.runs_rate_limiter` (set to None to disable).
    """

    override_set = hasattr(request.app.state, "runs_rate_limiter")
    limiter = (
        request.app.state.runs_rate_limiter if override_set else _default_runs_limiter()
    )
    _enforce(
        limiter,
        f"user:{claims.user_id}",
        "Too many run saves — please wait a moment and try again.",
    )


def enforce_saved_routes_write_rate_limit(
    request: Request, claims: CurrentClaims
) -> None:
    """429 when a user exceeds their saved-routes-upsert budget.

    Tests override via `app.state.saved_routes_rate_limiter` (None disables).
    """

    override_set = hasattr(request.app.state, "saved_routes_rate_limiter")
    limiter = (
        request.app.state.saved_routes_rate_limiter
        if override_set
        else _default_saved_routes_limiter()
    )
    _enforce(
        limiter,
        f"user:{claims.user_id}",
        "Too many saved route writes — please wait a moment and try again.",
    )
