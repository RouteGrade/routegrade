"""Tests for POST /v1/routes/plan with stubbed providers."""

from __future__ import annotations

import pytest

from app.api.routes.plans import get_route_planner
from app.providers.base import AddressNotFound, GeneratedRoute, GeocodeResult, ProviderError
from app.services.route_planner import RoutePlanner

# A tiny loop near Nathan Phillips Square (lng, lat).
_LOOP = [
    [-79.3832, 43.6519],
    [-79.3849, 43.6515],
    [-79.3871, 43.6510],
    [-79.3832, 43.6519],
]


class StubGeocoder:
    def __init__(self, result: GeocodeResult | Exception | None = None) -> None:
        self.result = result or GeocodeResult(
            latitude=43.6519, longitude=-79.3832, label="Nathan Phillips Square, Toronto"
        )
        self.calls: list[str] = []

    def geocode(self, query: str) -> GeocodeResult:
        self.calls.append(query)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class StubRouting:
    """Returns a route whose distance depends on the bearing, so candidates differ."""

    def __init__(self, distances_by_call: list[float] | None = None, fail: bool = False) -> None:
        self.fail = fail
        self.distances = distances_by_call
        self.calls = 0

    def generate_loop(self, *, latitude, longitude, distance_km, bearing_deg):
        self.calls += 1
        if self.fail:
            raise ProviderError("routing", "engine down")
        if self.distances is not None:
            distance = self.distances[(self.calls - 1) % len(self.distances)]
        else:
            distance = distance_km
        return GeneratedRoute(
            coordinates=_LOOP,
            distance_km=distance,
            intersections_per_km=3.0,
            provider="osrm",
            sidewalk_coverage=None,
        )


class StubElevation:
    def __init__(self, profile: list[float] | None = None) -> None:
        self.profile = profile

    def elevations(self, coordinates):
        if self.profile is not None:
            return self.profile[: len(coordinates)] + [self.profile[-1]] * max(
                0, len(coordinates) - len(self.profile)
            )
        return [100.0] * len(coordinates)


@pytest.fixture()
def plan_client(client, app_with_overrides):
    """Client whose planner is backed by fully-stubbed providers."""

    def _with(planner: RoutePlanner):
        app_with_overrides.dependency_overrides[get_route_planner] = lambda: planner
        return client

    yield _with
    app_with_overrides.dependency_overrides.pop(get_route_planner, None)


def _planner(
    geocoder=None, routing=None, elevation=None, tolerance: float = 0.10
) -> RoutePlanner:
    return RoutePlanner(
        geocoder=geocoder or StubGeocoder(),
        routing=routing or StubRouting(),
        elevation=elevation or StubElevation(),
        distance_tolerance=tolerance,
    )


def test_plan_returns_scored_routes_for_address(plan_client):
    c = plan_client(_planner())
    res = c.post(
        "/v1/routes/plan",
        json={"address": "Nathan Phillips Square, Toronto", "distance_km": 5, "preference": "quiet"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["start"]["label"] == "Nathan Phillips Square, Toronto"
    assert body["requested_distance_km"] == 5
    assert len(body["routes"]) == 3
    top = body["routes"][0]
    assert top["grade"] in {"A", "B", "C", "D"}
    assert top["geometry"]["type"] == "LineString"
    assert top["within_tolerance"] is True
    assert 0 <= top["score"] <= 100
    assert 0 <= top["elevation_subscore"] <= 100
    assert 0 <= top["intersection_subscore"] <= 100


def test_plan_accepts_coordinates_without_geocoding(plan_client):
    geocoder = StubGeocoder()
    c = plan_client(_planner(geocoder=geocoder))
    res = c.post(
        "/v1/routes/plan",
        json={"latitude": 43.65, "longitude": -79.38, "distance_km": 5},
    )
    assert res.status_code == 200
    assert geocoder.calls == []  # no geocoder round-trip for explicit coords
    assert res.json()["start"]["latitude"] == 43.65


def test_plan_requires_address_or_coordinates(plan_client):
    c = plan_client(_planner())
    res = c.post("/v1/routes/plan", json={"distance_km": 5})
    assert res.status_code == 422


def test_plan_rejects_out_of_range_distance(plan_client):
    c = plan_client(_planner())
    assert c.post("/v1/routes/plan", json={"address": "x", "distance_km": 0.2}).status_code == 422
    assert c.post("/v1/routes/plan", json={"address": "x", "distance_km": 99}).status_code == 422


def test_plan_unknown_address_maps_to_404(plan_client):
    c = plan_client(_planner(geocoder=StubGeocoder(AddressNotFound("geocoder", "no match"))))
    res = c.post("/v1/routes/plan", json={"address": "nowhere at all", "distance_km": 5})
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "address_not_found"


def test_plan_provider_outage_maps_to_502(plan_client):
    c = plan_client(_planner(routing=StubRouting(fail=True)))
    res = c.post("/v1/routes/plan", json={"address": "Toronto", "distance_km": 5})
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "provider_error"


def test_plan_flags_out_of_tolerance_routes(plan_client):
    # 5 km requested; candidates come back 5.1, 7.0 and 5.2 km.
    c = plan_client(_planner(routing=StubRouting(distances_by_call=[5.1, 7.0, 5.2])))
    res = c.post("/v1/routes/plan", json={"address": "Toronto", "distance_km": 5})
    body = res.json()
    flags = [r["within_tolerance"] for r in body["routes"]]
    assert flags == [True, True, False]  # in-tolerance candidates rank first
    assert body["routes"][-1]["distance_km"] == 7.0


def test_plan_is_public_no_auth_required(plan_client):
    c = plan_client(_planner())
    res = c.post(
        "/v1/routes/plan",
        json={"address": "Toronto", "distance_km": 5},
        headers={},  # explicitly no Authorization
    )
    assert res.status_code == 200


def test_plan_elevation_feeds_grade(plan_client):
    # A savage climb profile should drag the grade down versus dead-flat.
    climb = [100.0 + 20.0 * i for i in range(200)]
    flat_res = plan_client(_planner()).post(
        "/v1/routes/plan", json={"address": "Toronto", "distance_km": 5, "preference": "flat"}
    )
    hilly_res = plan_client(_planner(elevation=StubElevation(climb))).post(
        "/v1/routes/plan", json={"address": "Toronto", "distance_km": 5, "preference": "flat"}
    )
    flat_top = flat_res.json()["routes"][0]
    hilly_top = hilly_res.json()["routes"][0]
    assert hilly_top["elevation_gain_m"] > 0
    assert hilly_top["score"] < flat_top["score"]
