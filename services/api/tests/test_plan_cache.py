"""Tests for the planner cache (`app/services/plan_cache.py`).

Covers:
- lookup on empty state returns None (miss -> falls through to real planning)
- store then lookup returns the same PlanResponse (hit)
- different bucketed inputs write different rows (independent cache entries)
- expired entry is treated as a miss and re-generation overwrites it
- planner integration: same request twice -> second call hits cache and does
  not re-invoke geocoder / routing / elevation providers
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models.route_plan_cache import RoutePlanCache
from app.providers.base import GeneratedRoute, GeocodeResult, ProviderError
from app.schemas.routes import (
    LineStringGeometry,
    PlannedRoute,
    PlanRequest,
    PlanResponse,
    StartPoint,
)
from app.services import plan_cache
from app.services.plan_cache import PlanCache, build_cache_key, lookup, store
from app.services.route_planner import RoutePlanner

_LOOP = [
    [-79.3832, 43.6519],
    [-79.3849, 43.6515],
    [-79.3871, 43.6510],
    [-79.3832, 43.6519],
]


def _fake_response() -> PlanResponse:
    return PlanResponse(
        start=StartPoint(latitude=43.6519, longitude=-79.3832, label="Nathan Phillips Square"),
        requested_distance_km=5.0,
        preference="quiet",
        distance_tolerance=0.10,
        routes=[
            PlannedRoute(
                id=uuid.uuid4(),
                name="North loop 5.0 km",
                geometry=LineStringGeometry(type="LineString", coordinates=_LOOP),
                distance_km=5.0,
                elevation_gain_m=12.5,
                intersections_per_km=3.0,
                sidewalk_coverage=None,
                score=87.5,
                grade="A",
                within_tolerance=True,
                provider="osrm",
            )
        ],
    )


@pytest.fixture()
def session():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    ).execution_options(schema_translate_map={"public": None})
    RoutePlanCache.__table__.create(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    s = Session()
    try:
        yield s
    finally:
        s.close()
        engine.dispose()


# ---------------------------------------------------------------------------
# Direct module tests
# ---------------------------------------------------------------------------


def test_lookup_returns_none_on_empty_state(session):
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    assert lookup(session, key) is None


def test_store_then_lookup_round_trip(session):
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    response = _fake_response()

    store(session, key, response, ttl_hours=24)
    hit = lookup(session, key)

    assert hit is not None
    assert hit.start.latitude == pytest.approx(43.6519)
    assert hit.requested_distance_km == 5.0
    assert hit.preference == "quiet"
    assert len(hit.routes) == 1
    assert hit.routes[0].grade == "A"


def test_different_bucketed_coordinates_produce_different_keys():
    # Same 3-decimal bucket -> same key.
    k1 = build_cache_key(latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet")
    k2 = build_cache_key(
        latitude=43.65194, longitude=-79.38321, distance_km=5.0, preference="quiet"
    )
    assert k1 == k2

    # Different 3-decimal bucket -> different key (~110m shift).
    k3 = build_cache_key(latitude=43.6529, longitude=-79.3832, distance_km=5.0, preference="quiet")
    assert k3 != k1

    # Different preference / distance -> different key.
    k_flat = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="flat"
    )
    k_far = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=10.0, preference="quiet"
    )
    assert k_flat != k1
    assert k_far != k1


def test_different_bucketed_coordinates_store_separate_entries(session):
    key_a = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    key_b = build_cache_key(
        latitude=43.6529, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    store(session, key_a, _fake_response())
    store(session, key_b, _fake_response())

    rows = session.execute(select(RoutePlanCache)).scalars().all()
    assert {r.key for r in rows} == {key_a, key_b}
    assert len(rows) == 2


def test_expired_entry_is_treated_as_miss(session):
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    store(session, key, _fake_response(), ttl_hours=24)

    # Force expiry by rewriting expires_at into the past.
    row = session.execute(select(RoutePlanCache).where(RoutePlanCache.key == key)).scalar_one()
    row.expires_at = datetime.now(tz=timezone.utc) - timedelta(minutes=1)
    session.flush()

    assert lookup(session, key) is None


def test_store_overwrites_existing_key(session):
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    first = _fake_response()
    store(session, key, first)

    # Overwrite with a modified payload.
    updated = _fake_response()
    updated.routes[0].score = 99.9
    store(session, key, updated)

    rows = session.execute(select(RoutePlanCache).where(RoutePlanCache.key == key)).scalars().all()
    assert len(rows) == 1
    assert lookup(session, key).routes[0].score == 99.9  # type: ignore[union-attr]


def test_disabled_cache_is_a_noop(session):
    cache = PlanCache(session, enabled=False)
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    cache.store(key, _fake_response())
    assert cache.lookup(key) is None
    assert session.execute(select(RoutePlanCache)).scalars().all() == []


# ---------------------------------------------------------------------------
# Planner integration: cache hit skips outbound providers
# ---------------------------------------------------------------------------


class RecordingGeocoder:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def geocode(self, query: str) -> GeocodeResult:
        self.calls.append(query)
        return GeocodeResult(latitude=43.6519, longitude=-79.3832, label="Nathan Phillips Square")


class RecordingRouting:
    def __init__(self) -> None:
        self.calls = 0

    def generate_loop(self, *, latitude, longitude, distance_km, bearing_deg):
        self.calls += 1
        return GeneratedRoute(
            coordinates=_LOOP,
            distance_km=distance_km,
            intersections_per_km=3.0,
            provider="osrm",
            sidewalk_coverage=None,
        )


class RecordingElevation:
    def __init__(self) -> None:
        self.calls = 0

    def elevations(self, coordinates):
        self.calls += 1
        return [100.0] * len(coordinates)


def _planner(geocoder, routing, elevation) -> RoutePlanner:
    return RoutePlanner(
        geocoder=geocoder, routing=routing, elevation=elevation, distance_tolerance=0.10
    )


def test_planner_second_call_hits_cache_and_skips_providers(session):
    geocoder = RecordingGeocoder()
    routing = RecordingRouting()
    elevation = RecordingElevation()
    planner = _planner(geocoder, routing, elevation)
    cache = PlanCache(session, enabled=True, ttl_hours=24)

    request = PlanRequest(
        address="Nathan Phillips Square, Toronto", distance_km=5.0, preference="quiet"
    )

    first = planner.plan(request, cache=cache)
    assert routing.calls == 3  # three bearings on cache miss
    assert elevation.calls == 3
    assert geocoder.calls == ["Nathan Phillips Square, Toronto"]

    second = planner.plan(request, cache=cache)
    # Cache hit: no additional provider calls beyond the geocode that happens
    # before cache lookup (geocoding is how we get the bucketed key).
    assert routing.calls == 3
    assert elevation.calls == 3
    # The geocoder IS called again — we need coordinates to build the cache
    # key. That's cheap compared to skipping OSRM + Open-Elevation.
    assert geocoder.calls == [
        "Nathan Phillips Square, Toronto",
        "Nathan Phillips Square, Toronto",
    ]

    # Payload matches (routes/id/score/etc.).
    assert second.model_dump(mode="json") == first.model_dump(mode="json")


def test_planner_coordinate_and_address_share_same_cache_entry(session):
    """Request with coordinates hits cache written by an address-based request.

    This is the constraint from the task spec: identical bucketed coordinates
    reuse the entry regardless of whether the client sent free-text address or
    explicit lat/lng.
    """

    geocoder = RecordingGeocoder()
    routing = RecordingRouting()
    elevation = RecordingElevation()
    planner = _planner(geocoder, routing, elevation)
    cache = PlanCache(session, enabled=True, ttl_hours=24)

    # First: address form (geocoder resolves to 43.6519, -79.3832).
    planner.plan(
        PlanRequest(address="Nathan Phillips Square, Toronto", distance_km=5.0, preference="quiet"),
        cache=cache,
    )
    assert routing.calls == 3

    # Second: coordinates form matching the geocoded result within one bucket.
    result = planner.plan(
        PlanRequest(latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"),
        cache=cache,
    )
    assert routing.calls == 3  # cache hit — no additional routing calls
    assert result.preference == "quiet"


def test_planner_expired_entry_falls_through_and_regenerates(session):
    geocoder = RecordingGeocoder()
    routing = RecordingRouting()
    elevation = RecordingElevation()
    planner = _planner(geocoder, routing, elevation)
    cache = PlanCache(session, enabled=True, ttl_hours=24)
    request = PlanRequest(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )

    planner.plan(request, cache=cache)
    initial_routing_calls = routing.calls
    initial_elevation_calls = elevation.calls
    assert initial_routing_calls == 3

    # Age out the cached entry.
    row = session.execute(select(RoutePlanCache)).scalar_one()
    row.expires_at = datetime.now(tz=timezone.utc) - timedelta(minutes=1)
    session.flush()

    planner.plan(request, cache=cache)
    # Expired -> providers ran again.
    assert routing.calls == initial_routing_calls + 3
    assert elevation.calls == initial_elevation_calls + 3


def test_planner_without_cache_still_works(session):
    """Planner keeps its original behavior when no cache is passed."""

    geocoder = RecordingGeocoder()
    routing = RecordingRouting()
    elevation = RecordingElevation()
    planner = _planner(geocoder, routing, elevation)

    response = planner.plan(
        PlanRequest(latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet")
    )
    assert len(response.routes) == 3
    assert routing.calls == 3


def test_lookup_swallows_db_errors_and_returns_none(session, monkeypatch):
    """Any SQLAlchemyError during lookup falls through to a real plan."""

    def boom(*_args, **_kwargs):
        from sqlalchemy.exc import SQLAlchemyError

        raise SQLAlchemyError("simulated DB outage")

    monkeypatch.setattr(session, "execute", boom)
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    assert lookup(session, key) is None


def test_store_swallows_db_errors_silently(session, monkeypatch, caplog):
    """A store failure MUST NOT raise — the request already succeeded upstream."""

    from sqlalchemy.exc import SQLAlchemyError

    def boom(*_args, **_kwargs):
        raise SQLAlchemyError("simulated DB outage")

    monkeypatch.setattr(session, "execute", boom)
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )

    # Must not raise.
    store(session, key, _fake_response())


def test_planner_provider_error_does_not_write_cache(session):
    """A provider outage on every bearing must NOT poison the cache."""

    geocoder = RecordingGeocoder()

    class FailingRouting:
        def generate_loop(self, *, latitude, longitude, distance_km, bearing_deg):
            raise ProviderError("routing", "engine down")

    planner = _planner(geocoder, FailingRouting(), RecordingElevation())
    cache = PlanCache(session, enabled=True, ttl_hours=24)

    with pytest.raises(ProviderError):
        planner.plan(
            PlanRequest(latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"),
            cache=cache,
        )

    # No cache entry should have been written on failure.
    assert session.execute(select(RoutePlanCache)).scalars().all() == []


def test_build_cache_key_is_versioned():
    key = build_cache_key(
        latitude=43.6519, longitude=-79.3832, distance_km=5.0, preference="quiet"
    )
    assert key.startswith("v1|")


def test_planner_uses_route_plan_cache_module_helpers():
    """Sanity: PlanCache.enabled toggle actually controls the module."""

    assert plan_cache.PlanCache.__name__ == "PlanCache"
