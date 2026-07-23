"""Tests for POST /v1/routes/custom (grade a user-drawn route) and snap_trace.

The endpoint tests stub the routing engine's `snap_trace`; a separate unit test
exercises the real OSRM `/match` parsing in `OSRMRoutingEngine.snap_trace` with
httpx monkeypatched, so no network or OSRM server is needed.
"""

from __future__ import annotations

import httpx
import pytest

from app.api.routes.plans import get_route_planner
from app.providers.base import GeneratedRoute, GeocodeResult, ProviderError
from app.providers.routing import OSRMRoutingEngine, _downsample
from app.services.route_planner import RoutePlanner

# A short hand-drawn trace (lng, lat) near Nathan Phillips Square.
_TRACE = [
    [-79.3832, 43.6519],
    [-79.3840, 43.6517],
    [-79.3851, 43.6514],
    [-79.3860, 43.6512],
]


class StubGeocoder:
    def geocode(self, query: str) -> GeocodeResult:  # pragma: no cover - unused here
        return GeocodeResult(latitude=43.65, longitude=-79.38, label="stub")


class StubElevation:
    def __init__(self, profile: list[float] | None = None) -> None:
        self.profile = profile

    def elevations(self, coordinates):
        if self.profile is not None:
            return self.profile[: len(coordinates)] + [self.profile[-1]] * max(
                0, len(coordinates) - len(self.profile)
            )
        return [100.0] * len(coordinates)


class StubRouting:
    """A routing engine whose snap_trace returns a fixed matched route."""

    def __init__(self, generated: GeneratedRoute | Exception | None = None) -> None:
        self.generated = generated
        self.calls: list[list[list[float]]] = []

    def generate_loop(self, **_):  # pragma: no cover - not used by /custom
        raise NotImplementedError

    def snap_trace(self, coordinates):
        self.calls.append(coordinates)
        if isinstance(self.generated, Exception):
            raise self.generated
        return self.generated or GeneratedRoute(
            coordinates=[[-79.3832, 43.6519], [-79.3860, 43.6512]],
            distance_km=2.0,
            intersections_per_km=4.0,
            provider="osrm-match",
            sidewalk_coverage=None,
        )


def _planner(routing=None, elevation=None) -> RoutePlanner:
    return RoutePlanner(
        geocoder=StubGeocoder(),
        routing=routing or StubRouting(),
        elevation=elevation or StubElevation(),
    )


@pytest.fixture()
def custom_client(client, app_with_overrides):
    def _with(planner: RoutePlanner):
        app_with_overrides.dependency_overrides[get_route_planner] = lambda: planner
        return client

    yield _with
    app_with_overrides.dependency_overrides.pop(get_route_planner, None)


def test_custom_route_grades_a_drawn_trace(custom_client):
    routing = StubRouting()
    c = custom_client(_planner(routing=routing))
    res = c.post(
        "/v1/routes/custom",
        json={"coordinates": _TRACE, "preference": "quiet", "name": "My loop"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "My loop"
    assert body["grade"] in {"A", "B", "C", "D"}
    assert body["geometry"]["type"] == "LineString"
    assert body["distance_km"] == 2.0
    assert body["provider"] == "osrm-match"
    assert body["within_tolerance"] is True
    assert 0 <= body["score"] <= 100
    # The drawn trace was forwarded to the matcher.
    assert routing.calls == [_TRACE]


def test_custom_route_defaults_blank_name(custom_client):
    c = custom_client(_planner())
    res = c.post("/v1/routes/custom", json={"coordinates": _TRACE, "name": "   "})
    assert res.status_code == 200
    assert res.json()["name"] == "My route"


def test_custom_route_requires_two_points(custom_client):
    c = custom_client(_planner())
    res = c.post("/v1/routes/custom", json={"coordinates": [[-79.38, 43.65]]})
    assert res.status_code == 422


def test_custom_route_rejects_bad_coordinates(custom_client):
    c = custom_client(_planner())
    res = c.post(
        "/v1/routes/custom",
        json={"coordinates": [[-79.38, 43.65], [999.0, 43.65]]},
    )
    assert res.status_code == 422


def test_custom_route_provider_error_maps_to_502(custom_client):
    routing = StubRouting(ProviderError("routing", "no match"))
    c = custom_client(_planner(routing=routing))
    res = c.post("/v1/routes/custom", json={"coordinates": _TRACE})
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "provider_error"


# --- OSRMRoutingEngine.snap_trace unit tests (OSRM /match parsing) ---


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def _match_payload() -> dict:
    return {
        "code": "Ok",
        "matchings": [
            {
                "distance": 1500.0,
                "geometry": {
                    "type": "LineString",
                    "coordinates": [
                        [-79.3832, 43.6519],
                        [-79.3845, 43.6516],
                        [-79.3860, 43.6512],
                    ],
                },
                "legs": [
                    {
                        "steps": [
                            {"maneuver": {"type": "depart"}},
                            {"maneuver": {"type": "turn"}},
                            {"maneuver": {"type": "turn"}},
                            {"maneuver": {"type": "arrive"}},
                        ]
                    }
                ],
            }
        ],
    }


def test_snap_trace_parses_match_response(monkeypatch):
    captured = {}

    def fake_get(url, params=None, timeout=None):
        captured["url"] = url
        captured["params"] = params
        return _FakeResponse(_match_payload())

    monkeypatch.setattr(httpx, "get", fake_get)
    engine = OSRMRoutingEngine("http://osrm.test", profile="foot")
    result = engine.snap_trace(_TRACE)

    assert "/match/v1/foot/" in captured["url"]
    assert captured["params"]["tidy"] == "true"
    assert result.provider == "osrm-match"
    assert result.distance_km == pytest.approx(1.5)
    assert len(result.coordinates) == 3
    # 2 real maneuvers (depart/arrive excluded) over 1.5 km.
    assert result.intersections_per_km == pytest.approx(2 / 1.5)


def test_snap_trace_raises_on_no_match(monkeypatch):
    monkeypatch.setattr(
        httpx, "get", lambda *a, **k: _FakeResponse({"code": "NoMatch", "matchings": []})
    )
    engine = OSRMRoutingEngine("http://osrm.test")
    with pytest.raises(ProviderError):
        engine.snap_trace(_TRACE)


def test_downsample_keeps_endpoints_and_caps():
    coords = [[float(i), 0.0] for i in range(500)]
    thinned = _downsample(coords, 100)
    assert len(thinned) <= 100
    assert thinned[0] == coords[0]
    assert thinned[-1] == coords[-1]
    # Small inputs pass through untouched.
    assert _downsample(_TRACE, 100) == _TRACE
