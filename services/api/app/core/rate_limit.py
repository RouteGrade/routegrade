"""Per-key token-bucket rate limiter with three interchangeable backends.

Why three backends:

- **In-memory** (`TokenBucketLimiter`): dependency-free, per-process. Correct
  for a single-instance deployment (local dev, tests). Wrong for horizontally
  scaled serverless — each instance holds its own bucket, so the effective
  global limit fans out to `limit x instances`.
- **Postgres** (`PostgresTokenBucketLimiter`): cross-instance, no new vendor.
  RouteGrade already pays for Supabase Postgres and `DATABASE_URL` is set in
  prod, so this is the zero-config default. Bucket state lives in
  `public.rate_limit_buckets` and every check is a single atomic
  `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` (wrapped in a CTE that
  captures the pre-refill state) that folds the refill math into the SQL — so
  two concurrent requests on the same key can never both spend the last token.
- **Redis / Upstash** (`RedisTokenBucketLimiter`): opt-in when the founder has
  provisioned Upstash. Talks to Upstash's HTTPS REST API using a single atomic
  Lua script for refill + consume + persist.

All three satisfy the `RateLimiter` protocol so callers stay identical. The
`get_limiter()` factory picks the backend from environment settings:
Redis (if Upstash creds present) > Postgres (default when `DATABASE_URL` is set
and `RATE_LIMIT_USE_POSTGRES=true`) > in-memory.

Fail-open contract: infrastructure failures (Postgres timeout, Redis down)
must never take the site offline. Both non-memory backends log the error and
allow the request. Rate limiting is a safety valve, not an authorization gate;
abuse spikes during an outage are strictly less harmful than an outage of our
own writes.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

logger = logging.getLogger(__name__)


class RateLimiter(Protocol):
    """Backend-agnostic contract. Consumers depend only on this."""

    def check(self, key: str) -> tuple[bool, float]:
        """Try to consume one token for `key`.

        Returns `(allowed, retry_after_seconds)`. `retry_after_seconds` is
        `0.0` when `allowed` is True and a positive estimate otherwise.
        """


# ---------------------------------------------------------------------------
# In-memory backend (kept dependency-free for local dev + tests)
# ---------------------------------------------------------------------------


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
# Postgres backend (default in production — cross-instance, no new vendor)
# ---------------------------------------------------------------------------


# Why a CTE? A plain INSERT ... ON CONFLICT ... RETURNING can emit the post-op
# `tokens` value, but not an unambiguous `allowed` flag: with capacity >= 2 a
# post-op `tokens` in [0, 1) could mean "denied" (available < 1) OR "allowed
# and decremented from available in [1, 2)". The CTE captures the pre-refill
# `available` in a `prev` subquery *before* the UPSERT, then the SELECT at the
# end reports whether that value was >= 1 — the same test the CASE used to
# decide whether to decrement.
#
# Atomicity: PostgreSQL evaluates the CTE and the UPSERT in a single snapshot
# for the SELECT parts, and the UPSERT's UPDATE takes a ROW EXCLUSIVE lock on
# the conflicting row. A second concurrent call on the same key blocks on that
# lock until the first commits, then re-reads the row and computes its own
# refill against the fresh state. There is no window in which two requests can
# both observe `tokens >= 1` and both decrement.
_POSTGRES_REFILL_SQL = """
WITH prev AS (
    SELECT
        LEAST(
            b.capacity,
            b.tokens + (:now_ms - b.last_refill_ms) / 1000.0 * b.refill_rate
        ) AS available
    FROM public.rate_limit_buckets b
    WHERE b.key = :key
),
upsert AS (
    INSERT INTO public.rate_limit_buckets (key, tokens, last_refill_ms, capacity, refill_rate)
    VALUES (:key, :capacity - 1, :now_ms, :capacity, :refill_rate)
    ON CONFLICT (key) DO UPDATE SET
        tokens = CASE
            WHEN (SELECT available FROM prev) >= 1.0
                THEN (SELECT available FROM prev) - 1.0
            ELSE (SELECT available FROM prev)
        END,
        last_refill_ms = :now_ms,
        capacity = :capacity,
        refill_rate = :refill_rate
    RETURNING tokens, (xmax = 0) AS was_insert
)
SELECT
    upsert.tokens,
    CASE
        WHEN upsert.was_insert THEN TRUE
        WHEN (SELECT available FROM prev) >= 1.0 THEN TRUE
        ELSE FALSE
    END AS allowed
FROM upsert
"""


class PostgresTokenBucketLimiter:
    """Postgres-backed token bucket. Cross-instance, atomic, fail-open on errors.

    Runs each check in its own AUTOCOMMIT connection so:
    - A caller's outer transaction (if any) can neither roll back rate-limit
      state nor be poisoned by a rate-limit statement error.
    - Row locks are released immediately, keeping contention to a single row.

    Errors (timeout, connection failure, unexpected exception) are logged and
    the request is allowed through — rate limiting must not be a hard
    dependency for serving traffic.
    """

    _STATEMENT_TIMEOUT_MS = 500

    def __init__(
        self,
        *,
        rate_per_minute: float,
        capacity: int,
        sessionmaker_factory: Any = None,
    ) -> None:
        if rate_per_minute <= 0 or capacity <= 0:
            raise ValueError("rate_per_minute and capacity must be positive")
        self._rate_per_second = rate_per_minute / 60.0
        self._capacity = float(capacity)
        # Deferred import so the module stays importable even in environments
        # that have not configured the DB layer (e.g. unit-test collection).
        if sessionmaker_factory is None:
            from app.db.session import get_sessionmaker

            sessionmaker_factory = get_sessionmaker
        self._sessionmaker_factory = sessionmaker_factory

    def check(self, key: str) -> tuple[bool, float]:
        from sqlalchemy import text

        now_ms = int(time.time() * 1000)
        try:
            session_factory = self._sessionmaker_factory()
        except Exception as exc:  # noqa: BLE001
            logger.warning("rate_limit.postgres.sessionmaker_error", extra={"error": str(exc)})
            return True, 0.0

        session = session_factory()
        try:
            # AUTOCOMMIT: each check is a standalone txn, immune to outer rollback.
            session.connection(execution_options={"isolation_level": "AUTOCOMMIT"})
            dialect = session.bind.dialect.name if session.bind is not None else ""
            if dialect == "postgresql":
                # Belt-and-braces: cap the operation at 500ms so a slow DB
                # can't stall request handling.
                session.execute(
                    text(f"SET statement_timeout TO {self._STATEMENT_TIMEOUT_MS}")
                )
                sql = _POSTGRES_REFILL_SQL
            else:
                # SQLite path (dev/tests): no xmax, so emulate with a simpler
                # form that reads-then-writes under the same connection.
                return self._check_sqlite(session, key, now_ms)

            result = session.execute(
                text(sql),
                {
                    "key": key,
                    "capacity": self._capacity,
                    "refill_rate": self._rate_per_second,
                    "now_ms": now_ms,
                },
            )
            row = result.first()
            if row is None:
                logger.warning("rate_limit.postgres.no_row", extra={"key": key})
                return True, 0.0

            new_tokens = float(row[0])
            allowed = bool(row[1])
            if allowed:
                return True, 0.0
            return False, self._retry_after(new_tokens)
        except Exception as exc:  # noqa: BLE001 — fail-open on any DB error
            logger.warning(
                "rate_limit.postgres.error",
                extra={"key": key, "error": str(exc)},
            )
            return True, 0.0
        finally:
            session.close()

    def _check_sqlite(self, session: Any, key: str, now_ms: int) -> tuple[bool, float]:
        """SQLite fallback (dev/tests only). Uses a read-then-upsert on one
        connection so the read and write share the same transaction; SQLite is
        single-writer so no other connection can interleave."""

        from sqlalchemy import text

        row = session.execute(
            text("SELECT tokens, last_refill_ms FROM rate_limit_buckets WHERE key = :key"),
            {"key": key},
        ).first()
        if row is None:
            session.execute(
                text(
                    "INSERT INTO rate_limit_buckets"
                    " (key, tokens, last_refill_ms, capacity, refill_rate)"
                    " VALUES (:key, :tokens, :now_ms, :capacity, :refill_rate)"
                ),
                {
                    "key": key,
                    "tokens": self._capacity - 1,
                    "now_ms": now_ms,
                    "capacity": self._capacity,
                    "refill_rate": self._rate_per_second,
                },
            )
            return True, 0.0

        prev_tokens = float(row[0])
        prev_ts = int(row[1])
        available = min(
            self._capacity,
            prev_tokens + (now_ms - prev_ts) / 1000.0 * self._rate_per_second,
        )
        if available >= 1.0:
            new_tokens = available - 1.0
            allowed = True
        else:
            new_tokens = available
            allowed = False

        session.execute(
            text(
                "UPDATE rate_limit_buckets"
                " SET tokens = :tokens, last_refill_ms = :now_ms,"
                " capacity = :capacity, refill_rate = :refill_rate"
                " WHERE key = :key"
            ),
            {
                "key": key,
                "tokens": new_tokens,
                "now_ms": now_ms,
                "capacity": self._capacity,
                "refill_rate": self._rate_per_second,
            },
        )
        if allowed:
            return True, 0.0
        return False, self._retry_after(new_tokens)

    def _retry_after(self, tokens: float) -> float:
        if tokens >= 1.0 or self._rate_per_second <= 0:
            return 0.0
        return (1.0 - tokens) / self._rate_per_second


# ---------------------------------------------------------------------------
# Redis (Upstash REST) backend — opt-in for higher throughput
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
# Factory: pick backend from environment
# ---------------------------------------------------------------------------


_UNSET: Any = object()


def get_limiter(
    *,
    rate_per_minute: float,
    capacity: int,
    settings: Any | None = None,
    upstash_url: str | None = _UNSET,
    upstash_token: str | None = _UNSET,
    key_prefix: str = "rg:rl:",
) -> RateLimiter | None:
    """Choose a backend. Priority: Redis > Postgres > in-memory.

    Returns None when `rate_per_minute <= 0` or `capacity <= 0` (rate limiting
    explicitly disabled).

    Backend selection reads BOTH sets of env-derived flags:
    - `upstash_redis_rest_url` + `upstash_redis_rest_token` → Redis
    - `rate_limit_use_postgres` + `database_url` → Postgres
    - otherwise → in-memory

    Callers may pass explicit `upstash_url`/`upstash_token` (used by
    `app/api/rate_limit_deps.py` and `app/api/routes/plans.py`) to keep the
    call site self-contained. When either is left unset, the corresponding
    value is read from `settings` (loaded via `get_settings()` if not passed).
    """

    if rate_per_minute <= 0 or capacity <= 0:
        return None

    # Only load settings lazily — some callers (tests) pass explicit
    # Upstash creds and never want to touch app config.
    def _load_settings() -> Any:
        nonlocal settings
        if settings is None:
            from app.core.config import get_settings

            settings = get_settings()
        return settings

    resolved_url = (
        upstash_url
        if upstash_url is not _UNSET
        else getattr(_load_settings(), "upstash_redis_rest_url", None)
    )
    resolved_token = (
        upstash_token
        if upstash_token is not _UNSET
        else getattr(_load_settings(), "upstash_redis_rest_token", None)
    )

    if resolved_url and resolved_token:
        logger.info("rate_limit.backend.redis")
        return RedisTokenBucketLimiter(
            rest_url=resolved_url,
            rest_token=resolved_token,
            rate_per_minute=rate_per_minute,
            capacity=capacity,
            key_prefix=key_prefix,
        )

    s = _load_settings()
    database_url = getattr(s, "database_url", None)
    use_postgres = getattr(s, "rate_limit_use_postgres", False)
    if database_url and use_postgres:
        logger.info("rate_limit.backend.postgres")
        return PostgresTokenBucketLimiter(
            rate_per_minute=rate_per_minute,
            capacity=capacity,
        )

    logger.info("rate_limit.backend.memory")
    return TokenBucketLimiter(rate_per_minute=rate_per_minute, capacity=capacity)
