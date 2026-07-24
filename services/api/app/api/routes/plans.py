"""Public route-planning endpoint: POST /v1/routes/plan.

Public by design — MVP 1's unauthenticated route experience stays available.
Per-IP rate limiting is a documented pre-launch requirement (see
docs/routing-setup.md) since every call fans out to external providers.
"""

from __future__ import annotations

import math
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.config import Settings, get_settings
from app.core.rate_limit import RateLimiter, get_limiter
from app.providers.base import AddressNotFound, ProviderError
from app.providers.elevation import OpenElevationClient
from app.providers.geocoding import NominatimGeocoder
from app.providers.routing import OSRMRoutingEngine
from app.schemas.routes import (
    CustomRouteRequest,
    NearestRequest,
    NearestResponse,
    PlannedRoute,
    PlanRequest,
    PlanResponse,
    SegmentRequest,
    SegmentResponse,
    SnapRouteRequest,
    SnapRouteResponse,
)
from app.services.route_planner import RoutePlanner

router = APIRouter(prefix="/v1/routes", tags=["routes"])


def get_route_planner(
    settings: Annotated[Settings, Depends(get_settings)],
) -> RoutePlanner:
    """Build a planner from configured providers. Tests override this dependency."""

    return RoutePlanner(
        geocoder=NominatimGeocoder(
            settings.geocoder_base_url,
            user_agent=settings.geocoder_user_agent,
            timeout=settings.provider_timeout_seconds,
        ),
        routing=OSRMRoutingEngine(
            settings.osrm_base_url,
            profile=settings.osrm_profile,
            timeout=settings.provider_timeout_seconds,
        ),
        elevation=OpenElevationClient(
            settings.elevation_base_url,
            timeout=settings.provider_timeout_seconds,
        ),
        distance_tolerance=settings.route_plan_distance_tolerance,
    )


@lru_cache(maxsize=1)
def _default_rate_limiter() -> RateLimiter | None:
    settings = get_settings()
    if settings.route_plan_rate_limit_per_minute <= 0:
        return None
    return get_limiter(
        rate_per_minute=settings.route_plan_rate_limit_per_minute,
        capacity=settings.route_plan_rate_limit_per_minute
        + settings.route_plan_rate_limit_burst,
        settings=settings,
        upstash_url=settings.upstash_redis_rest_url,
        upstash_token=settings.upstash_redis_rest_token,
        key_prefix="rg:rl:plan:",
    )


def _client_key(request: Request) -> str:
    """Trusted client IP, resistant to X-Forwarded-For spoofing.

    Vercel (and most reverse proxies) *appends* the real client IP to
    `X-Forwarded-For`, so the leftmost hop is client-controlled and can be
    used to rotate through fake IPs and bypass per-IP buckets. Preferred
    signal order:

    1. `x-real-ip` — Vercel populates this with the actual client IP.
    2. Rightmost `x-forwarded-for` hop — the last proxy to touch us.
    3. `request.client.host` — direct connection fallback.
    """

    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            # Rightmost hop is the last proxy we trust to have written it.
            return hops[-1]

    return request.client.host if request.client else "unknown"


def enforce_plan_rate_limit(request: Request) -> None:
    """429 + Retry-After when a client exceeds the /plan budget.

    Tests may override via `app.state.plan_rate_limiter` (None disables).
    """

    override_set = hasattr(request.app.state, "plan_rate_limiter")
    limiter = (
        request.app.state.plan_rate_limiter if override_set else _default_rate_limiter()
    )
    if limiter is None:
        return

    allowed, retry_after = limiter.check(_client_key(request))
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "rate_limited",
                "message": "Too many route plans — please wait a moment and try again.",
            },
            headers={"Retry-After": str(max(1, math.ceil(retry_after)))},
        )


@router.post("/plan", response_model=PlanResponse, dependencies=[Depends(enforce_plan_rate_limit)])
def plan_route(
    payload: PlanRequest,
    planner: Annotated[RoutePlanner, Depends(get_route_planner)],
) -> PlanResponse:
    try:
        return planner.plan(payload)
    except AddressNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "address_not_found",
                "message": "We couldn't find that starting address.",
            },
        ) from None
    except ProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "provider_error",
                "message": "A routing provider is unavailable. Please try again shortly.",
            },
        ) from None


@router.post(
    "/custom",
    response_model=PlannedRoute,
    dependencies=[Depends(enforce_plan_rate_limit)],
)
def grade_custom_route(
    payload: CustomRouteRequest,
    planner: Annotated[RoutePlanner, Depends(get_route_planner)],
) -> PlannedRoute:
    """Snap a user-drawn trace to the road network and grade it.

    Public like /plan, and shares its per-IP budget — both fan out to the same
    external routing/elevation providers.
    """

    name = (payload.name or "").strip() or "My route"
    try:
        return planner.grade_drawn(
            coordinates=payload.coordinates,
            preference=payload.preference,
            name=name,
        )
    except ProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "provider_error",
                "message": "We couldn't snap that route to the map. Try drawing it again.",
            },
        ) from None


@router.post(
    "/nearest",
    response_model=NearestResponse,
    dependencies=[Depends(enforce_plan_rate_limit)],
)
def nearest_point(
    payload: NearestRequest,
    planner: Annotated[RoutePlanner, Depends(get_route_planner)],
) -> NearestResponse:
    """Snap a cursor point to the nearest routable point (assisted draw)."""

    try:
        return planner.nearest(payload.point)
    except ProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "provider_error",
                "message": "We couldn't find a nearby path there.",
            },
        ) from None


@router.post(
    "/segment",
    response_model=SegmentResponse,
    dependencies=[Depends(enforce_plan_rate_limit)],
)
def route_segment(
    payload: SegmentRequest,
    planner: Annotated[RoutePlanner, Depends(get_route_planner)],
) -> SegmentResponse:
    """Route one drawn segment between two points (geometry + distance)."""

    try:
        return planner.route_segment(payload.start, payload.end)
    except ProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "provider_error",
                "message": "We couldn't route between those points.",
            },
        ) from None


@router.post(
    "/snap",
    response_model=SnapRouteResponse,
    dependencies=[Depends(enforce_plan_rate_limit)],
)
def snap_route(
    payload: SnapRouteRequest,
    planner: Annotated[RoutePlanner, Depends(get_route_planner)],
) -> SnapRouteResponse:
    """Snap a drawn trace onto roads (geometry only) for live assisted drawing.

    Public, shares /plan's per-IP budget. Grading happens later via /custom.
    """

    try:
        return planner.snap(payload.coordinates)
    except ProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "provider_error",
                "message": "We couldn't snap that route to the map.",
            },
        ) from None
