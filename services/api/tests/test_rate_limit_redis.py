"""Tests for the Upstash-REST Redis rate-limit backend.

We mock the HTTP layer with `httpx.MockTransport` so no real network call
happens. The tests cover:

- Request shape sent to Upstash (method, URL, auth header, JSON body).
- Atomic token consumption (allowed / retry_after decoded from Lua result).
- Fail-open on every distinct failure mode: network timeout, non-2xx HTTP,
  malformed JSON, unexpected response shape, Upstash-reported error.
- Sensible TTL sent with the EVAL call.
- Factory selects Redis vs in-memory based on env vars.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.core.rate_limit import (
    RedisTokenBucketLimiter,
    TokenBucketLimiter,
    get_limiter,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _RecordingResponder:
    """Callable that captures requests and returns configured responses."""

    def __init__(self, responses: list[httpx.Response | Exception]) -> None:
        self._responses = responses
        self.requests: list[httpx.Request] = []
        self.bodies: list[Any] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.bodies.append(json.loads(request.content.decode("utf-8")))
        if not self._responses:
            raise AssertionError("MockTransport called more times than expected")
        nxt = self._responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


def _make_limiter(
    responder: _RecordingResponder,
    *,
    rate_per_minute: float = 60,
    capacity: int = 3,
    timeout_seconds: float = 0.4,
) -> RedisTokenBucketLimiter:
    client = httpx.Client(transport=httpx.MockTransport(responder), timeout=timeout_seconds)
    return RedisTokenBucketLimiter(
        rest_url="https://example.upstash.io",
        rest_token="test-token",
        rate_per_minute=rate_per_minute,
        capacity=capacity,
        client=client,
    )


def _ok(allowed: int, remaining_scaled: int = 0, retry_ms: int = 0) -> httpx.Response:
    return httpx.Response(
        200,
        json={"result": [allowed, remaining_scaled, retry_ms]},
    )


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


def test_request_shape_sent_to_upstash() -> None:
    responder = _RecordingResponder([_ok(1, remaining_scaled=2000)])
    limiter = _make_limiter(responder, rate_per_minute=60, capacity=3)

    allowed, retry_after = limiter.check("user:42")

    assert allowed is True
    assert retry_after == 0.0

    # Exactly one HTTP call.
    assert len(responder.requests) == 1
    req = responder.requests[0]
    assert req.method == "POST"
    assert req.url.host == "example.upstash.io"
    assert req.headers["Authorization"] == "Bearer test-token"
    assert req.headers["content-type"].startswith("application/json")

    body = responder.bodies[0]
    # Upstash REST expects [command, ...args] as a JSON array.
    assert isinstance(body, list)
    assert body[0] == "EVAL"
    # Lua script text passes through unmodified.
    assert "HMGET" in body[1] and "HMSET" in body[1]
    # KEYS + ARGV shape: numkeys, key, capacity, rate/s, now_ms, ttl.
    assert body[2] == "1"
    assert body[3].startswith("rg:rl:") and body[3].endswith("user:42")
    assert int(body[4]) == 3  # capacity
    assert float(body[5]) == pytest.approx(1.0)  # 60/min = 1/s
    assert int(body[6]) > 0  # now_ms
    assert int(body[7]) >= 60  # ttl


def test_denies_when_lua_returns_zero() -> None:
    responder = _RecordingResponder([_ok(0, remaining_scaled=0, retry_ms=1500)])
    limiter = _make_limiter(responder)

    allowed, retry_after = limiter.check("user:42")

    assert allowed is False
    # Lua returned 1500ms -> 1.5s.
    assert retry_after == pytest.approx(1.5)


def test_key_prefix_applied() -> None:
    responder = _RecordingResponder([_ok(1)])
    client = httpx.Client(transport=httpx.MockTransport(responder))
    limiter = RedisTokenBucketLimiter(
        rest_url="https://example.upstash.io",
        rest_token="tok",
        rate_per_minute=60,
        capacity=3,
        key_prefix="custom:",
        client=client,
    )

    limiter.check("bob")

    assert responder.bodies[0][3] == "custom:bob"


def test_ttl_scales_with_capacity_and_rate() -> None:
    # rate = 1/s, capacity = 120 -> ttl ~= 240s.
    responder = _RecordingResponder([_ok(1)])
    limiter = _make_limiter(responder, rate_per_minute=60, capacity=120)

    limiter.check("x")

    ttl = int(responder.bodies[0][7])
    assert ttl >= 120  # at least capacity / rate


# ---------------------------------------------------------------------------
# Fail-open scenarios
# ---------------------------------------------------------------------------


def test_fails_open_on_network_timeout(caplog) -> None:
    responder = _RecordingResponder([httpx.ConnectTimeout("boom")])
    limiter = _make_limiter(responder)

    with caplog.at_level("WARNING"):
        allowed, retry_after = limiter.check("k")

    assert allowed is True
    assert retry_after == 0.0
    assert any("fail_open" in r.message for r in caplog.records)


def test_fails_open_on_http_5xx() -> None:
    responder = _RecordingResponder([httpx.Response(503, text="upstream down")])
    limiter = _make_limiter(responder)

    allowed, retry_after = limiter.check("k")

    assert (allowed, retry_after) == (True, 0.0)


def test_fails_open_on_http_401() -> None:
    responder = _RecordingResponder([httpx.Response(401, text="bad token")])
    limiter = _make_limiter(responder)

    assert limiter.check("k") == (True, 0.0)


def test_fails_open_on_malformed_json() -> None:
    responder = _RecordingResponder([httpx.Response(200, text="not json{{{")])
    limiter = _make_limiter(responder)

    assert limiter.check("k") == (True, 0.0)


def test_fails_open_on_upstash_error_field() -> None:
    responder = _RecordingResponder(
        [httpx.Response(200, json={"error": "WRONGTYPE bad key"})]
    )
    limiter = _make_limiter(responder)

    assert limiter.check("k") == (True, 0.0)


def test_fails_open_on_unexpected_result_shape() -> None:
    responder = _RecordingResponder([httpx.Response(200, json={"result": "OK"})])
    limiter = _make_limiter(responder)

    assert limiter.check("k") == (True, 0.0)


def test_fails_open_on_short_result_array() -> None:
    responder = _RecordingResponder([httpx.Response(200, json={"result": [1, 2]})])
    limiter = _make_limiter(responder)

    assert limiter.check("k") == (True, 0.0)


def test_fails_open_on_non_numeric_result() -> None:
    responder = _RecordingResponder(
        [httpx.Response(200, json={"result": ["yes", "no", "maybe"]})]
    )
    limiter = _make_limiter(responder)

    assert limiter.check("k") == (True, 0.0)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def test_factory_returns_in_memory_when_upstash_unset() -> None:
    limiter = get_limiter(
        rate_per_minute=60,
        capacity=10,
        upstash_url=None,
        upstash_token=None,
    )
    assert isinstance(limiter, TokenBucketLimiter)


def test_factory_returns_in_memory_when_only_one_set() -> None:
    limiter = get_limiter(
        rate_per_minute=60,
        capacity=10,
        upstash_url="https://example.upstash.io",
        upstash_token="",
    )
    assert isinstance(limiter, TokenBucketLimiter)


def test_factory_returns_redis_when_both_set() -> None:
    limiter = get_limiter(
        rate_per_minute=60,
        capacity=10,
        upstash_url="https://example.upstash.io",
        upstash_token="tok",
    )
    assert isinstance(limiter, RedisTokenBucketLimiter)
    limiter.close()


def test_validation_rejects_bad_params() -> None:
    with pytest.raises(ValueError):
        RedisTokenBucketLimiter(
            rest_url="https://x", rest_token="y", rate_per_minute=0, capacity=1
        )
    with pytest.raises(ValueError):
        RedisTokenBucketLimiter(
            rest_url="https://x", rest_token="y", rate_per_minute=1, capacity=0
        )
    with pytest.raises(ValueError):
        RedisTokenBucketLimiter(
            rest_url="", rest_token="y", rate_per_minute=1, capacity=1
        )
    with pytest.raises(ValueError):
        RedisTokenBucketLimiter(
            rest_url="https://x", rest_token="", rate_per_minute=1, capacity=1
        )
