"""End-to-end tests: cache wired through the FastAPI `/v1/routes/plan` endpoint.

Verifies the DI graph (`get_plan_cache` -> `PlanCache` -> planner) works as
designed when `route_plan_cache_enabled=True`. Complements `test_plan_cache.py`
which exercises the cache module directly.
"""

from __future__ import annotations

import pytest

from app.api.routes.plans import get_plan_cache, get_route_planner
from app.core.config import Settings, get_settings
from app.providers.base import GeneratedRoute, GeocodeResult
from app.services.plan_cache import PlanCache
from app.services.route_planner import RoutePlanner

_LOOP = [
    [-79.3832, 43.6519],
    [-79.3849, 43.6515],
    [-79.3871, 43.6510],
    [-79.3832, 43.6519],
]


class CountingRouting:
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


class CountingElevation:
    def __init__(self) -> None:
        self.calls = 0

    def elevations(self, coordinates):
        self.calls += 1
        return [100.0] * len(coordinates)


class StubGeocoder:
    def geocode(self, query: str) -> GeocodeResult:
        return GeocodeResult(latitude=43.6519, longitude=-79.3832, label=query)


@pytest.fixture()
def cached_client(client, app_with_overrides, db_session):
    """FastAPI client with cache enabled and shared providers/session.

    The default test env sets `ROUTE_PLAN_CACHE_ENABLED=false` (so unrelated
    tests keep re-computing between calls). This fixture flips it back on and
    binds a single stub-planner across requests so we can count provider hits.
    """

    routing = CountingRouting()
    elevation = CountingElevation()
    planner = RoutePlanner(
        geocoder=StubGeocoder(),
        routing=routing,
        elevation=elevation,
        distance_tolerance=0.10,
    )

    def override_planner() -> RoutePlanner:
        return planner

    def override_cache() -> PlanCache:
        # Force enabled=True regardless of test env; share ONE db_session so
        # writes persist across requests inside a single test.
        return PlanCache(db_session, enabled=True, ttl_hours=24)

    def override_settings() -> Settings:
        # Reflect the same enabled=True stance for anything else that reads it.
        s = get_settings()
        return s.model_copy(update={"route_plan_cache_enabled": True})

    app_with_overrides.dependency_overrides[get_route_planner] = override_planner
    app_with_overrides.dependency_overrides[get_plan_cache] = override_cache
    app_with_overrides.dependency_overrides[get_settings] = override_settings

    yield client, routing, elevation


def test_repeated_endpoint_call_hits_cache(cached_client):
    client, routing, elevation = cached_client
    body = {"latitude": 43.6519, "longitude": -79.3832, "distance_km": 5.0, "preference": "quiet"}

    first = client.post("/v1/routes/plan", json=body)
    assert first.status_code == 200
    assert routing.calls == 3
    assert elevation.calls == 3
    first_payload = first.json()

    second = client.post("/v1/routes/plan", json=body)
    assert second.status_code == 200
    # No additional outbound provider calls on the cached hit.
    assert routing.calls == 3
    assert elevation.calls == 3
    assert second.json() == first_payload


def test_distinct_preferences_are_cached_separately(cached_client):
    client, routing, elevation = cached_client
    common = {"latitude": 43.6519, "longitude": -79.3832, "distance_km": 5.0}

    client.post("/v1/routes/plan", json={**common, "preference": "quiet"})
    assert routing.calls == 3

    client.post("/v1/routes/plan", json={**common, "preference": "flat"})
    # Different preference -> different key -> fresh compute.
    assert routing.calls == 6

    # Repeat "quiet" -> hits the first entry.
    client.post("/v1/routes/plan", json={**common, "preference": "quiet"})
    assert routing.calls == 6
