"""Tests for the extended rate-limit coverage and the XFF-spoof fix.

Covers:

- Per-user limiting on `PUT /v1/users/me/runs/{id}` and
  `PUT /v1/users/me/routes/{id}` — including per-user isolation and burst
  behavior.
- The `_client_key` fix: a hostile leftmost `X-Forwarded-For` cannot rotate
  through fake IPs to bypass the /plan bucket.
"""

from __future__ import annotations

import uuid

import pytest

from app.api.routes.plans import _client_key, get_route_planner
from app.core.rate_limit import TokenBucketLimiter
from app.services.route_planner import RoutePlanner

from tests.test_routes_plan import StubElevation, StubGeocoder, StubRouting


def _run_payload(**overrides):
    payload = {
        "route_id": str(uuid.uuid4()),
        "route_name": "loop",
        "started_at": "2026-07-18T12:00:00Z",
        "duration_s": 1810,
        "distance_km": 5.12,
        "avg_pace_s_per_km": 354,
        "splits": [],
        "path": None,
    }
    payload.update(overrides)
    return payload


def _route_payload(**overrides):
    payload = {
        "name": "loop",
        "starting_address": "Toronto",
        "distance_km": 5.1,
        "preference": "quiet",
        "geometry": {
            "type": "LineString",
            "coordinates": [
                [-79.3832, 43.6519],
                [-79.3849, 43.6515],
                [-79.3871, 43.6510],
                [-79.3832, 43.6519],
            ],
        },
        "elevation_gain_m": 42.0,
        "score": 87.5,
        "grade": "A",
    }
    payload.update(overrides)
    return payload


@pytest.fixture()
def auth_headers(token_factory):
    def _for(sub: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token_factory(sub=sub)}"}

    return _for


# ---------------------------------------------------------------------------
# Runs endpoint
# ---------------------------------------------------------------------------


class TestRunsRateLimit:
    def _install(self, app):
        # 60/min, capacity 3 — three quick calls then 429.
        app.state.runs_rate_limiter = TokenBucketLimiter(
            rate_per_minute=60, capacity=3
        )

    def test_burst_allowed_then_429(self, client, app_with_overrides, auth_headers):
        self._install(app_with_overrides)
        user = str(uuid.uuid4())
        headers = auth_headers(user)

        for _ in range(3):
            res = client.put(
                f"/v1/users/me/runs/{uuid.uuid4()}",
                json=_run_payload(),
                headers=headers,
            )
            assert res.status_code == 201

        blocked = client.put(
            f"/v1/users/me/runs/{uuid.uuid4()}",
            json=_run_payload(),
            headers=headers,
        )
        assert blocked.status_code == 429
        assert blocked.json()["detail"]["code"] == "rate_limited"
        assert int(blocked.headers["Retry-After"]) >= 1

    def test_isolated_per_user(self, client, app_with_overrides, auth_headers):
        self._install(app_with_overrides)
        alice = str(uuid.uuid4())
        bob = str(uuid.uuid4())

        # Exhaust Alice's bucket.
        for _ in range(3):
            assert (
                client.put(
                    f"/v1/users/me/runs/{uuid.uuid4()}",
                    json=_run_payload(),
                    headers=auth_headers(alice),
                ).status_code
                == 201
            )
        assert (
            client.put(
                f"/v1/users/me/runs/{uuid.uuid4()}",
                json=_run_payload(),
                headers=auth_headers(alice),
            ).status_code
            == 429
        )

        # Bob still has a full bucket.
        assert (
            client.put(
                f"/v1/users/me/runs/{uuid.uuid4()}",
                json=_run_payload(),
                headers=auth_headers(bob),
            ).status_code
            == 201
        )

    def test_read_endpoints_are_not_limited(
        self, client, app_with_overrides, auth_headers
    ):
        self._install(app_with_overrides)
        user = str(uuid.uuid4())
        headers = auth_headers(user)

        # Exhaust the write bucket.
        for _ in range(3):
            client.put(
                f"/v1/users/me/runs/{uuid.uuid4()}", json=_run_payload(), headers=headers
            )
        assert (
            client.put(
                f"/v1/users/me/runs/{uuid.uuid4()}", json=_run_payload(), headers=headers
            ).status_code
            == 429
        )

        # GET stays available.
        assert client.get("/v1/users/me/runs", headers=headers).status_code == 200


# ---------------------------------------------------------------------------
# Saved routes endpoint
# ---------------------------------------------------------------------------


class TestSavedRoutesRateLimit:
    def _install(self, app):
        app.state.saved_routes_rate_limiter = TokenBucketLimiter(
            rate_per_minute=60, capacity=3
        )

    def test_burst_allowed_then_429(self, client, app_with_overrides, auth_headers):
        self._install(app_with_overrides)
        headers = auth_headers(str(uuid.uuid4()))

        for _ in range(3):
            res = client.put(
                f"/v1/users/me/routes/{uuid.uuid4()}",
                json=_route_payload(),
                headers=headers,
            )
            assert res.status_code == 201

        blocked = client.put(
            f"/v1/users/me/routes/{uuid.uuid4()}",
            json=_route_payload(),
            headers=headers,
        )
        assert blocked.status_code == 429
        assert blocked.json()["detail"]["code"] == "rate_limited"

    def test_isolated_per_user(self, client, app_with_overrides, auth_headers):
        self._install(app_with_overrides)
        alice = str(uuid.uuid4())
        bob = str(uuid.uuid4())

        for _ in range(3):
            client.put(
                f"/v1/users/me/routes/{uuid.uuid4()}",
                json=_route_payload(),
                headers=auth_headers(alice),
            )
        assert (
            client.put(
                f"/v1/users/me/routes/{uuid.uuid4()}",
                json=_route_payload(),
                headers=auth_headers(alice),
            ).status_code
            == 429
        )

        assert (
            client.put(
                f"/v1/users/me/routes/{uuid.uuid4()}",
                json=_route_payload(),
                headers=auth_headers(bob),
            ).status_code
            == 201
        )


# ---------------------------------------------------------------------------
# XFF spoof fix
# ---------------------------------------------------------------------------


@pytest.fixture()
def plan_limited_client(client, app_with_overrides):
    app_with_overrides.dependency_overrides[get_route_planner] = lambda: RoutePlanner(
        geocoder=StubGeocoder(),
        routing=StubRouting(),
        elevation=StubElevation(),
    )
    app_with_overrides.state.plan_rate_limiter = TokenBucketLimiter(
        rate_per_minute=60, capacity=3
    )
    yield client
    app_with_overrides.dependency_overrides.pop(get_route_planner, None)


class TestXffSpoofFix:
    def test_leftmost_xff_cannot_bypass_bucket(self, plan_limited_client):
        """Attacker rotates the *leftmost* XFF hop — must not reset the bucket."""

        # Exhaust the bucket using distinct spoofed leftmost hops each time.
        for i in range(3):
            res = plan_limited_client.post(
                "/v1/routes/plan",
                json={"address": "Toronto", "distance_km": 5},
                headers={"X-Forwarded-For": f"198.51.100.{i}, 10.0.0.1"},
            )
            assert res.status_code == 200

        # A fourth request with yet another spoofed leftmost hop must still 429,
        # because the trusted key is the rightmost hop (10.0.0.1).
        blocked = plan_limited_client.post(
            "/v1/routes/plan",
            json={"address": "Toronto", "distance_km": 5},
            headers={"X-Forwarded-For": "203.0.113.99, 10.0.0.1"},
        )
        assert blocked.status_code == 429

    def test_x_real_ip_takes_precedence(self, plan_limited_client):
        """`x-real-ip` (Vercel's trusted header) is preferred over XFF."""

        for _ in range(3):
            res = plan_limited_client.post(
                "/v1/routes/plan",
                json={"address": "Toronto", "distance_km": 5},
                headers={
                    "X-Real-IP": "192.0.2.7",
                    "X-Forwarded-For": "1.2.3.4, 10.0.0.1",
                },
            )
            assert res.status_code == 200

        blocked = plan_limited_client.post(
            "/v1/routes/plan",
            json={"address": "Toronto", "distance_km": 5},
            headers={
                "X-Real-IP": "192.0.2.7",
                "X-Forwarded-For": "9.9.9.9, 10.0.0.1",
            },
        )
        assert blocked.status_code == 429


class TestClientKeyDirect:
    """Unit-test the key selector so the intent is pinned down without HTTP."""

    def _request(self, headers: dict[str, str] | None = None, host: str | None = "1.1.1.1"):
        # Minimal stand-in for a starlette Request.
        class _Client:
            def __init__(self, h: str) -> None:
                self.host = h

        class _Req:
            def __init__(self):
                self.headers = headers or {}
                self.client = _Client(host) if host else None

        return _Req()

    def test_prefers_x_real_ip(self):
        req = self._request(
            {"x-real-ip": "192.0.2.7", "x-forwarded-for": "1.2.3.4, 10.0.0.1"}
        )
        assert _client_key(req) == "192.0.2.7"

    def test_falls_back_to_rightmost_xff(self):
        req = self._request({"x-forwarded-for": "1.2.3.4, 5.6.7.8, 10.0.0.1"})
        assert _client_key(req) == "10.0.0.1"

    def test_falls_back_to_client_host(self):
        req = self._request(None)
        assert _client_key(req) == "1.1.1.1"

    def test_unknown_when_no_client(self):
        req = self._request(None, host=None)
        assert _client_key(req) == "unknown"
