"""Per-key token-bucket rate limiter with pluggable storage backends.

Two backends are provided:

- `TokenBucketLimiter`: in-process, dependency-free. Good enough for a single
  API instance (the MVP 4 deployment shape). Each Vercel instance has its own
  buckets, so the effective global limit is `limit * instances`.
- `RedisTokenBucketLimiter`: talks to Upstash Redis over its REST API using
  a single atomic Lua script. Enforces a shared global limit across every
  instance.

Both implement the same `check(key) -> (allowed, retry_after_seconds)` contract
so callers never see which backend is in use. `get_limiter()` is the sole
activation switch — set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
and redeploy; nothing else changes.

Failure policy for the Redis backend: on ANY error talking to Upstash (network
timeout, non-2xx HTTP, malformed JSON, unexpected response shape) the limiter
logs a warning and **fails open** — the request is allowed. Infra hiccups must
never block real users; abuse spikes during an Upstash outage are strictly less
harmful than an outage of our own writes.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Protocol

import httpx


logger = logging.getLogger(__name__)


class RateLimiter(Protocol):
    """Backend-agnostic contract. Consumers depend only on this."""

    def check(self, key: str) -> tuple[bool, float]:
        """Try to consume one token for `key`.

        Returns `(allowed, retry_after_seconds)`. `retry_after_seconds` is
        `0.0` when `allowed` is True and a positive estimate otherwise.
        """


@dataclass
class _Bucket:
    tokens: float
    updated_at: float


class TokenBucketLimiter:
    """`rate_per_minute` sustained, `capacity` burst. `check` is thread-safe.

    In-process backend. Buckets live only in this instance's memory.
    """

    def __init__(self, *, rate_per_minute: float, capacity: int) -> None:
        if rate_per_minute <= 0 or capacity <= 0:
            raise ValueError("rate_per_minute and capacity must be positive")
        self._rate_per_second = rate_per_minute / 60.0
        self._capacity = float(capacity)
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()
        self._last_prune = time.monotonic()

    def check(self, key: str) -> tuple[bool, float]:
        now = time.monotonic()
        with self._lock:
            self._maybe_prune(now)
            bucket = self._buckets.get(key)
            if bucket is None:
                bucket = _Bucket(tokens=self._capacity, updated_at=now)
                self._buckets[key] = bucket
            else:
                elapsed = now - bucket.updated_at
                bucket.tokens = min(
                    self._capacity, bucket.tokens + elapsed * self._rate_per_second
                )
                bucket.updated_at = now

            if bucket.tokens >= 1.0:
                bucket.tokens -= 1.0
                return True, 0.0

            retry_after = (1.0 - bucket.tokens) / self._rate_per_second
            return False, retry_after

    def _maybe_prune(self, now: float) -> None:
        """Drop buckets idle long enough to be full again (bounds memory)."""

        if now - self._last_prune < 60.0:
            return
        self._last_prune = now
        idle_cutoff = self._capacity / self._rate_per_second
        stale = [
            key
            for key, bucket in self._buckets.items()
            if now - bucket.updated_at > idle_cutoff
        ]
        for key in stale:
            del self._buckets[key]


# ---------------------------------------------------------------------------
# Redis (Upstash REST) backend
# ---------------------------------------------------------------------------


# Lua script: atomic token-bucket refill + consume. Stores two fields under
# `key`: `t` (current tokens, float) and `u` (last-update wallclock ms).
# ARGV: capacity, rate_per_second, now_ms, ttl_seconds.
# Returns: {allowed(0|1), remaining_tokens_scaled, retry_after_ms}.
# `remaining_tokens_scaled` is tokens * 1000 (Redis Lua returns integers).
_TOKEN_BUCKET_LUA = """
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call('HMGET', KEYS[1], 't', 'u')
local tokens = tonumber(data[1])
local updated = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  updated = now
end

local elapsed_ms = now - updated
if elapsed_ms < 0 then elapsed_ms = 0 end
tokens = math.min(capacity, tokens + (elapsed_ms / 1000.0) * rate)

local allowed = 0
local retry_ms = 0
if tokens >= 1.0 then
  tokens = tokens - 1.0
  allowed = 1
else
  retry_ms = math.ceil(((1.0 - tokens) / rate) * 1000)
end

redis.call('HMSET', KEYS[1], 't', tostring(tokens), 'u', tostring(now))
redis.call('EXPIRE', KEYS[1], ttl)

return {allowed, math.floor(tokens * 1000), retry_ms}
"""


class RedisTokenBucketLimiter:
    """Upstash REST-backed token-bucket limiter.

    The Upstash REST API accepts Redis commands as JSON arrays and returns
    JSON `{result, error}`. We use the `EVAL` command with an inline Lua
    script so refill + consume + persist happens atomically inside Redis.

    All errors fail open — see the module docstring.
    """

    # Under 500ms per the P1 spec. Redis calls should be sub-100ms in practice.
    _DEFAULT_TIMEOUT_SECONDS = 0.4

    def __init__(
        self,
        *,
        rest_url: str,
        rest_token: str,
        rate_per_minute: float,
        capacity: int,
        key_prefix: str = "rg:rl:",
        timeout_seconds: float | None = None,
        client: httpx.Client | None = None,
    ) -> None:
        if rate_per_minute <= 0 or capacity <= 0:
            raise ValueError("rate_per_minute and capacity must be positive")
        if not rest_url or not rest_token:
            raise ValueError("rest_url and rest_token are required")

        self._rate_per_second = rate_per_minute / 60.0
        self._capacity = int(capacity)
        self._key_prefix = key_prefix
        # TTL: long enough that a bucket that would refill to full still exists,
        # short enough that abandoned keys don't linger. Capacity / rate + slack.
        self._ttl_seconds = max(60, int(self._capacity / self._rate_per_second) * 2)
        timeout = timeout_seconds if timeout_seconds is not None else self._DEFAULT_TIMEOUT_SECONDS

        self._rest_url = rest_url.rstrip("/")
        self._auth_header = f"Bearer {rest_token}"
        self._client = client or httpx.Client(timeout=timeout)
        # Track whether we own the client so we can close it cleanly.
        self._owns_client = client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def check(self, key: str) -> tuple[bool, float]:
        namespaced = f"{self._key_prefix}{key}"
        now_ms = int(time.time() * 1000)
        # Upstash REST body for EVAL: [command, ...args]
        body = [
            "EVAL",
            _TOKEN_BUCKET_LUA,
            "1",
            namespaced,
            str(self._capacity),
            f"{self._rate_per_second:.6f}",
            str(now_ms),
            str(self._ttl_seconds),
        ]
        try:
            response = self._client.post(
                self._rest_url,
                headers={"Authorization": self._auth_header},
                json=body,
            )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("rate_limit.redis.fail_open key=%s error=%s", key, exc)
            return True, 0.0

        if not isinstance(data, dict) or "result" not in data or data.get("error"):
            logger.warning(
                "rate_limit.redis.fail_open key=%s unexpected_response=%r", key, data
            )
            return True, 0.0

        result = data["result"]
        # Upstash EVAL returns the Lua table as a JSON array.
        if not isinstance(result, list) or len(result) < 3:
            logger.warning("rate_limit.redis.fail_open key=%s bad_result=%r", key, result)
            return True, 0.0

        try:
            allowed = int(result[0]) == 1
            retry_after_ms = int(result[2])
        except (TypeError, ValueError):
            logger.warning("rate_limit.redis.fail_open key=%s parse_error=%r", key, result)
            return True, 0.0

        if allowed:
            return True, 0.0
        return False, retry_after_ms / 1000.0


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_limiter(
    *,
    rate_per_minute: float,
    capacity: int,
    upstash_url: str | None,
    upstash_token: str | None,
    key_prefix: str = "rg:rl:",
) -> RateLimiter:
    """Choose the Redis backend when configured, otherwise the in-memory one.

    This is the *sole* activation switch. When the founder provisions Upstash
    and sets `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in Vercel,
    the next deploy silently upgrades every limiter to the shared backend —
    no code change, no other config toggle.
    """

    if upstash_url and upstash_token:
        return RedisTokenBucketLimiter(
            rest_url=upstash_url,
            rest_token=upstash_token,
            rate_per_minute=rate_per_minute,
            capacity=capacity,
            key_prefix=key_prefix,
        )
    return TokenBucketLimiter(rate_per_minute=rate_per_minute, capacity=capacity)
