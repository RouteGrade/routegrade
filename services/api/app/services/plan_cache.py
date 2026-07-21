"""Planner cache: transparent read-through cache for `PlanResponse` payloads.

Design (see docs/routing-setup.md pre-launch requirement):

- The cache is looked up INSIDE the planner, AFTER the start point has been
  resolved to concrete coordinates. So a client that sends free-text address
  "Nathan Phillips Square" and another that sends the equivalent lat/lng both
  hit the same entry — geocoding happens once, then the coordinates are
  bucketed to build the cache key.

- The key is derived from `(lat_bucket, lng_bucket, distance_km_bucket,
  preference)`. Coordinate buckets use 3 decimal places, which is roughly a
  ~110m grid at Toronto's latitude (see `_bucket_coord`). This is intentionally
  coarser than the OSRM loop generator's ±10% distance tolerance: two runners
  standing 50m apart with identical preferences will get the same three
  candidates. Any tighter (4 decimals, ~11m) and adjacent starts miss the
  cache constantly; any coarser (2 decimals, ~1.1km) and we'd serve loops
  that clearly don't start at the requested pin.

- Fail-safe: any DB error during `lookup` or `store` logs a warning and
  returns None / silently no-ops. The planner never blocks on cache infra.

- Expiration is lazy: readers filter on `expires_at > now()`. Garbage
  collection is a follow-up (TODO below): recommend a periodic sweep via
  Vercel Cron running `DELETE FROM route_plans WHERE expires_at < now()`.

- PII: `payload_json` is the exact `PlanResponse` we'd otherwise compute
  (start.latitude, start.longitude, start.label, and route geometries). Start
  labels can be user-supplied strings when a request came in with an address;
  when a request comes in with coordinates the label is a formatted lat/lng.
  Neither is direct PII in the strict sense — but we intentionally *do not*
  key on address text, so cache reuse is coordinate-based only.

TODO(follow-up): scheduled sweep. Recommended approach — Vercel Cron hitting
`POST /v1/internal/route-plans/sweep` (auth-gated), running
`DELETE FROM public.route_plans WHERE expires_at < now()`. Not implemented
here because lazy expiration is sufficient for MVP-scale traffic.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.models.route_plan_cache import RoutePlanCache
from app.schemas.routes import PlanResponse

logger = logging.getLogger(__name__)

# 3 decimals ~= 110m at Toronto's latitude; see module docstring for rationale.
_COORD_DECIMALS = 3
# Distance-km bucket: nearest 0.1km. Requests for 5.0 and 5.05 km share a slot.
_DISTANCE_BUCKET_KM = 0.1


def _bucket_coord(value: float) -> str:
    """Bucket a latitude or longitude to a stable, hashable string.

    Rounding to `_COORD_DECIMALS` decimal places gives ~110m grid resolution
    at Toronto's latitude (43.65 degrees). We stringify with fixed precision
    so `43.6519999...` and `43.652` bucket identically regardless of float
    representation drift.
    """

    return f"{round(value, _COORD_DECIMALS):.{_COORD_DECIMALS}f}"


def _bucket_distance(distance_km: float) -> str:
    """Bucket the requested distance to the nearest 0.1 km."""

    bucketed = round(distance_km / _DISTANCE_BUCKET_KM) * _DISTANCE_BUCKET_KM
    return f"{bucketed:.1f}"


def build_cache_key(
    *, latitude: float, longitude: float, distance_km: float, preference: str
) -> str:
    """Canonical cache key over bucketed coordinates + distance + preference.

    Deterministic and reproducible: given the same bucketed values, always
    the same string. Keeps the DB unique-index happy.
    """

    return "|".join(
        [
            "v1",  # schema version — bump if the payload shape changes
            _bucket_coord(latitude),
            _bucket_coord(longitude),
            _bucket_distance(distance_km),
            preference,
        ]
    )


def lookup(session: Session, key: str) -> PlanResponse | None:
    """Return a cached `PlanResponse` for `key`, or None on miss/expired/error.

    Any exception is caught and logged — cache infrastructure must never block
    a real planning request.
    """

    try:
        row = session.execute(
            select(RoutePlanCache).where(RoutePlanCache.key == key)
        ).scalar_one_or_none()
    except SQLAlchemyError:
        logger.warning("route_plan_cache lookup failed", exc_info=True)
        return None

    if row is None:
        return None

    now = _now()
    expires_at = _as_aware(row.expires_at)
    if expires_at <= now:
        return None  # expired — treat as a miss; a background sweep can drop it

    try:
        response = PlanResponse.model_validate(row.payload_json)
    except ValidationError:
        # Payload shape changed under our feet (e.g. schema evolved).
        # Treat as a miss; the next store will overwrite via upsert semantics.
        logger.warning("route_plan_cache payload failed validation for key=%s", key)
        return None

    # Best-effort hit-count bookkeeping. If it fails, don't fail the hit.
    try:
        row.hit_count = (row.hit_count or 0) + 1
        row.last_hit_at = now
        session.flush()
    except SQLAlchemyError:
        logger.warning("route_plan_cache hit-count update failed", exc_info=True)
        session.rollback()

    return response


class PlanCache:
    """Session-bound cache handle passed into the planner.

    Wrapping the (session, ttl, enabled) triple keeps the planner API narrow:
    `planner.plan(request, cache=...)` either short-circuits on a hit or writes
    on miss. When `enabled=False`, both methods are silent no-ops so the
    planner code path stays uniform.
    """

    def __init__(self, session: Session, *, enabled: bool = True, ttl_hours: int = 24) -> None:
        self._session = session
        self._enabled = enabled
        self._ttl_hours = ttl_hours

    @property
    def enabled(self) -> bool:
        return self._enabled

    def lookup(self, key: str) -> PlanResponse | None:
        if not self._enabled:
            return None
        return lookup(self._session, key)

    def store(self, key: str, response: PlanResponse) -> None:
        if not self._enabled:
            return
        store(self._session, key, response, ttl_hours=self._ttl_hours)


def store(
    session: Session,
    key: str,
    response: PlanResponse,
    *,
    ttl_hours: int = 24,
) -> None:
    """Persist `response` under `key`. No-op on DB error (logged).

    If an entry with this `key` already exists (concurrent request wrote first,
    or a stale entry that lazy expiration hasn't dropped yet), we refresh it in
    place so the TTL slides forward and the payload matches what we'd return
    now.
    """

    now = _now()
    expires_at = now + timedelta(hours=ttl_hours)
    payload = response.model_dump(mode="json")

    try:
        existing = session.execute(
            select(RoutePlanCache).where(RoutePlanCache.key == key)
        ).scalar_one_or_none()

        if existing is None:
            session.add(
                RoutePlanCache(
                    id=uuid.uuid4(),
                    key=key,
                    payload_json=payload,
                    created_at=now,
                    expires_at=expires_at,
                    hit_count=0,
                    last_hit_at=None,
                )
            )
        else:
            existing.payload_json = payload
            existing.expires_at = expires_at
            existing.created_at = now

        session.commit()
    except SQLAlchemyError:
        logger.warning("route_plan_cache store failed", exc_info=True)
        session.rollback()


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _as_aware(value: datetime) -> datetime:
    """SQLite drops tzinfo on round-trip; treat naive timestamps as UTC."""

    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
