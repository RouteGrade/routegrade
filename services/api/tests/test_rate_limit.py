"""Tests for the /v1/routes/plan per-IP rate limiter."""

from __future__ import annotations

import pytest

from app.api.routes.plans import get_route_planner
from app.core.rate_limit import TokenBucketLimiter
from app.services.route_planner import RoutePlanner

from tests.test_routes_plan import StubElevation, StubGeocoder, StubRouting


@pytest.fixture()
def limited_client(client, app_with_overrides):
    app_with_overrides.dependency_overrides[get_route_planner] = lambda: RoutePlanner(
        geocoder=StubGeocoder(),
        routing=StubRouting(),
        elevation=StubElevation(),
    )
    # 60/min so tokens barely refill mid-test; capacity 3 = three quick calls.
    app_with_overrides.state.plan_rate_limiter = TokenBucketLimiter(
        rate_per_minute=60, capacity=3
    )
    yield client
    app_with_overrides.dependency_overrides.pop(get_route_planner, None)


def _plan(c):
    return c.post("/v1/routes/plan", json={"address": "Toronto", "distance_km": 5})


def test_burst_allowed_then_429_with_retry_after(limited_client):
    for _ in range(3):
        assert _plan(limited_client).status_code == 200

    blocked = _plan(limited_client)
    assert blocked.status_code == 429
    assert blocked.json()["detail"]["code"] == "rate_limited"
    assert int(blocked.headers["Retry-After"]) >= 1


def test_limit_is_per_client_ip(limited_client):
    for _ in range(3):
        assert _plan(limited_client).status_code == 200
    assert _plan(limited_client).status_code == 429

    # A different client (via proxy header) still has a full bucket.
    other = limited_client.post(
        "/v1/routes/plan",
        json={"address": "Toronto", "distance_km": 5},
        headers={"X-Forwarded-For": "203.0.113.9, 10.0.0.1"},
    )
    assert other.status_code == 200


def test_tokens_refill_over_time():
    limiter = TokenBucketLimiter(rate_per_minute=6000, capacity=1)  # 100/sec
    assert limiter.check("k")[0] is True
    allowed, retry_after = limiter.check("k")
    assert allowed is False
    assert 0 < retry_after <= 0.02

    import time

    time.sleep(0.02)
    assert limiter.check("k")[0] is True


def test_other_endpoints_not_limited(limited_client):
    for _ in range(3):
        _plan(limited_client)
    assert _plan(limited_client).status_code == 429
    # Health is untouched by the plan limiter.
    assert limited_client.get("/health").status_code == 200
