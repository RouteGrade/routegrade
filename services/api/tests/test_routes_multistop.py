"""Tests for the multi-stop route builder endpoints: /geocode and /alternatives."""

from __future__ import annotations

import pytest

from app.api.routes.plans import get_route_planner
from app.providers.base import AddressNotFound, GeocodeResult, ProviderError
from app.services.route_planner import RoutePlanner

_A = [-79.3832, 43.6519]
_B = [-79.3860, 43.6512]


class StubGeocoder:
    def __init__(self, result: GeocodeResult | Exception | None = None) -> None:
        self.result = result or GeocodeResult(
            latitude=43.6519, longitude=-79.3832, label="Nathan Phillips Square, Toronto"
        )

    def geocode(self, query: str) -> GeocodeResult:
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class StubElevation:
    def elevations(self, coordinates):  # pragma: no cover - unused
        return [100.0] * len(coordinates)


class StubRouting:
    def __init__(self, alternatives=None, fail: Exception | None = None) -> None:
        self.alternatives = alternatives or [
            ([[-79.3832, 43.6519], [-79.3860, 43.6512]], 1.2),
            ([[-79.3832, 43.6519], [-79.3850, 43.6530], [-79.3860, 43.6512]], 1.6),
        ]
        self.fail = fail

    def generate_loop(self, **_):  # pragma: no cover
        raise NotImplementedError

    def route_alternatives(self, start, end):
        if self.fail:
            raise self.fail
        return self.alternatives


def _planner(geocoder=None, routing=None) -> RoutePlanner:
    return RoutePlanner(
        geocoder=geocoder or StubGeocoder(),
        routing=routing or StubRouting(),
        elevation=StubElevation(),
    )


@pytest.fixture()
def client_with(client, app_with_overrides):
    def _with(planner: RoutePlanner):
        app_with_overrides.dependency_overrides[get_route_planner] = lambda: planner
        return client

    yield _with
    app_with_overrides.dependency_overrides.pop(get_route_planner, None)


# --- /v1/routes/geocode ---


def test_geocode_resolves_address(client_with):
    c = client_with(_planner())
    res = c.post("/v1/routes/geocode", json={"address": "Nathan Phillips Square"})
    assert res.status_code == 200
    body = res.json()
    assert body["latitude"] == 43.6519
    assert body["longitude"] == -79.3832
    assert "Toronto" in body["label"]


def test_geocode_unknown_address_maps_to_404(client_with):
    c = client_with(_planner(geocoder=StubGeocoder(AddressNotFound("geocoder", "no"))))
    res = c.post("/v1/routes/geocode", json={"address": "nowhere at all"})
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "address_not_found"


def test_geocode_requires_address(client_with):
    c = client_with(_planner())
    assert c.post("/v1/routes/geocode", json={"address": ""}).status_code == 422


# --- /v1/routes/alternatives ---


def test_alternatives_returns_route_options(client_with):
    c = client_with(_planner())
    res = c.post("/v1/routes/alternatives", json={"start": _A, "end": _B})
    assert res.status_code == 200
    routes = res.json()["routes"]
    assert len(routes) == 2
    assert routes[0]["geometry"]["type"] == "LineString"
    assert routes[1]["distance_km"] == 1.6


def test_alternatives_validates_points(client_with):
    c = client_with(_planner())
    assert (
        c.post("/v1/routes/alternatives", json={"start": _A, "end": [0.0]}).status_code
        == 422
    )


def test_alternatives_provider_error_maps_to_502(client_with):
    c = client_with(_planner(routing=StubRouting(fail=ProviderError("routing", "no"))))
    res = c.post("/v1/routes/alternatives", json={"start": _A, "end": _B})
    assert res.status_code == 502
