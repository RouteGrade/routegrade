"""Tests for the route-draw primitives: POST /v1/routes/nearest and /segment.

These back the waypoint-based drawing UI (Phase 0): snap a cursor point to the
network, and route one pedestrian segment between two points. Endpoint tests
stub the routing engine; unit tests exercise the real OSRM /nearest and /route
parsing with httpx monkeypatched, so no network or OSRM server is needed.
"""

from __future__ import annotations

import httpx
import pytest

from app.api.routes.plans import get_route_planner
from app.providers.base import GeocodeResult, ProviderError
from app.providers.routing import OSRMRoutingEngine
from app.services.route_planner import RoutePlanner

_A = [-79.3832, 43.6519]
_B = [-79.3860, 43.6512]


class StubGeocoder:
    def geocode(self, query: str) -> GeocodeResult:  # pragma: no cover - unused
        return GeocodeResult(latitude=43.65, longitude=-79.38, label="stub")


class StubElevation:
    def elevations(self, coordinates):  # pragma: no cover - unused here
        return [100.0] * len(coordinates)


class StubRouting:
    """Routing engine stub exposing nearest + route_segment for endpoint tests."""

    def __init__(
        self,
        *,
        nearest_result=None,
        segment_result=None,
        fail: Exception | None = None,
    ) -> None:
        self.nearest_result = nearest_result or [-79.3833, 43.6520]
        self.segment_result = segment_result or (
            [[-79.3833, 43.6520], [-79.3846, 43.6516], [-79.3861, 43.6513]],
            0.42,
        )
        self.fail = fail
        self.nearest_calls: list[tuple[float, float]] = []
        self.segment_calls: list[tuple[list[float], list[float]]] = []

    def generate_loop(self, **_):  # pragma: no cover - not used here
        raise NotImplementedError

    def nearest(self, lng: float, lat: float) -> list[float]:
        self.nearest_calls.append((lng, lat))
        if self.fail:
            raise self.fail
        return self.nearest_result

    def route_segment(self, start, end):
        self.segment_calls.append((start, end))
        if self.fail:
            raise self.fail
        return self.segment_result


def _planner(routing=None) -> RoutePlanner:
    return RoutePlanner(
        geocoder=StubGeocoder(),
        routing=routing or StubRouting(),
        elevation=StubElevation(),
    )


@pytest.fixture()
def draw_client(client, app_with_overrides):
    def _with(planner: RoutePlanner):
        app_with_overrides.dependency_overrides[get_route_planner] = lambda: planner
        return client

    yield _with
    app_with_overrides.dependency_overrides.pop(get_route_planner, None)


# --- /v1/routes/nearest ---


def test_nearest_snaps_a_point(draw_client):
    routing = StubRouting(nearest_result=[-79.3831, 43.6521])
    c = draw_client(_planner(routing=routing))
    res = c.post("/v1/routes/nearest", json={"point": _A})
    assert res.status_code == 200
    assert res.json()["snapped"] == [-79.3831, 43.6521]
    assert routing.nearest_calls == [(_A[0], _A[1])]


def test_nearest_validates_point(draw_client):
    c = draw_client(_planner())
    assert c.post("/v1/routes/nearest", json={"point": [-79.38]}).status_code == 422
    assert c.post("/v1/routes/nearest", json={"point": [200.0, 0.0]}).status_code == 422


def test_nearest_provider_error_maps_to_502(draw_client):
    c = draw_client(_planner(StubRouting(fail=ProviderError("routing", "no snap"))))
    assert c.post("/v1/routes/nearest", json={"point": _A}).status_code == 502


# --- /v1/routes/segment ---


def test_segment_routes_between_two_points(draw_client):
    routing = StubRouting(
        segment_result=([[-79.3833, 43.6520], [-79.3861, 43.6513]], 0.31)
    )
    c = draw_client(_planner(routing=routing))
    res = c.post("/v1/routes/segment", json={"start": _A, "end": _B})
    assert res.status_code == 200
    body = res.json()
    assert body["geometry"]["type"] == "LineString"
    assert len(body["geometry"]["coordinates"]) == 2
    assert body["distance_km"] == 0.31
    assert routing.segment_calls == [(_A, _B)]


def test_segment_validates_endpoints(draw_client):
    c = draw_client(_planner())
    assert (
        c.post("/v1/routes/segment", json={"start": _A, "end": [0.0]}).status_code == 422
    )


def test_segment_provider_error_maps_to_502(draw_client):
    c = draw_client(_planner(StubRouting(fail=ProviderError("routing", "no route"))))
    assert c.post("/v1/routes/segment", json={"start": _A, "end": _B}).status_code == 502


# --- OSRMRoutingEngine unit tests (real OSRM payload parsing) ---


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def test_engine_nearest_parses_waypoint(monkeypatch):
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["url"] = url
        return _FakeResponse(
            {"code": "Ok", "waypoints": [{"location": [-79.3831, 43.6521]}]}
        )

    monkeypatch.setattr(httpx, "get", fake_get)
    engine = OSRMRoutingEngine("http://osrm.test", profile="foot")
    assert engine.nearest(-79.3832, 43.6519) == [-79.3831, 43.6521]
    assert "/nearest/v1/foot/" in captured["url"]


def test_engine_nearest_raises_on_no_snap(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda *a, **k: _FakeResponse({"code": "NoSegment", "waypoints": []})
    )
    with pytest.raises(ProviderError):
        OSRMRoutingEngine("http://osrm.test").nearest(0.0, 0.0)


def test_engine_route_segment_parses_route(monkeypatch):
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["url"] = url
        return _FakeResponse(
            {
                "code": "Ok",
                "routes": [
                    {
                        "distance": 420.0,
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[-79.3833, 43.652], [-79.3861, 43.6513]],
                        },
                    }
                ],
            }
        )

    monkeypatch.setattr(httpx, "get", fake_get)
    engine = OSRMRoutingEngine("http://osrm.test", profile="foot")
    coords, distance_km = engine.route_segment(_A, _B)
    assert "/route/v1/foot/" in captured["url"]
    assert len(coords) == 2
    assert distance_km == pytest.approx(0.42)


def test_engine_route_segment_raises_on_no_route(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda *a, **k: _FakeResponse({"code": "NoRoute", "routes": []})
    )
    with pytest.raises(ProviderError):
        OSRMRoutingEngine("http://osrm.test").route_segment(_A, _B)
