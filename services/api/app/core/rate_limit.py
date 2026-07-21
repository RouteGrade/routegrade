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
  provisioned Upstash. Fewer round-trips, higher ceiling; same semantics via
  an atomic Lua script.

All three satisfy the `RateLimiter` protocol so callers stay identical. The
`get_limiter()` factory picks the backend from environment settings:
Redis (if creds present) > Postgres (default when DATABASE_URL is set) > memory.

Fail-open contract: infrastructure failures (Postgres timeout, Redis down)
must never take the site offline. Both non-memory backends log the error and
allow the request. Rate limiting is a safety valve, not an authorization gate.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol

logger = logging.getLogger(__name__)


class RateLimiter(Protocol):
    """Shared contract: consume one token for `key`, return (allowed, retry_after_s)."""

    def check(self, key: str) -> tuple[bool, float]: ...


# ---------------------------------------------------------------------------
# In-memory backend (kept dependency-free for local dev + tests)
# ---------------------------------------------------------------------------


@dataclass
class _Bucket:
    tokens: float
    updated_at: float


class TokenBucketLimiter:
    """`rate_per_minute` sustained, `capacity` burst. `check` is thread-safe."""

    def __init__(self, *, rate_per_minute: float, capacity: int) -> None:
        if rate_per_minute <= 0 or capacity <= 0:
            raise ValueError("rate_per_minute and capacity must be positive")
        self._rate_per_second = rate_per_minute / 60.0
        self._capacity = float(capacity)
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()
        self._last_prune = time.monotonic()

    def check(self, key: str) -> tuple[bool, float]:
        """Consume one token for `key`. Returns (allowed, retry_after_seconds)."""

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
# Redis / Upstash backend (opt-in for higher throughput)
# ---------------------------------------------------------------------------


# The Lua script runs atomically on the Redis server — Redis executes scripts
# under its single-threaded model, so concurrent calls on the same key are
# fully serialized.
_REDIS_TOKEN_BUCKET_LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])

if tokens == nil then
    tokens = capacity
    ts = now_ms
else
    local elapsed = (now_ms - ts) / 1000.0
    tokens = math.min(capacity, tokens + elapsed * refill_rate)
    ts = now_ms
end

local allowed = 0
if tokens >= 1 then
    tokens = tokens - 1
    allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
local ttl = math.max(60, math.ceil(2 * capacity / refill_rate))
redis.call('EXPIRE', key, ttl)

return {allowed, tostring(tokens)}
"""


class RedisTokenBucketLimiter:
    """Upstash Redis REST backed limiter. Same semantics as the Postgres one."""

    _TIMEOUT_S = 0.5

    def __init__(
        self,
        *,
        rate_per_minute: float,
        capacity: int,
        rest_url: str,
        rest_token: str,
        key_prefix: str = "rl:plan:",
        http_client: Any = None,
    ) -> None:
        if rate_per_minute <= 0 or capacity <= 0:
            raise ValueError("rate_per_minute and capacity must be positive")
        if not rest_url or not rest_token:
            raise ValueError("rest_url and rest_token are required")
        self._rate_per_second = rate_per_minute / 60.0
        self._capacity = float(capacity)
        self._rest_url = rest_url.rstrip("/")
        self._rest_token = rest_token
        self._key_prefix = key_prefix
        self._http_client = http_client  # injectable for tests

    def check(self, key: str) -> tuple[bool, float]:
        try:
            payload = [
                _REDIS_TOKEN_BUCKET_LUA,
                "1",
                f"{self._key_prefix}{key}",
                str(self._capacity),
                str(self._rate_per_second),
                str(int(time.time() * 1000)),
            ]
            headers = {"Authorization": f"Bearer {self._rest_token}"}
            if self._http_client is not None:
                response = self._http_client.post(
                    f"{self._rest_url}/eval",
                    json=payload,
                    headers=headers,
                    timeout=self._TIMEOUT_S,
                )
            else:
                import httpx

                response = httpx.post(
                    f"{self._rest_url}/eval",
                    json=payload,
                    headers=headers,
                    timeout=self._TIMEOUT_S,
                )
            response.raise_for_status()
            body = response.json()
            result = body.get("result") if isinstance(body, dict) else body
            if not isinstance(result, list) or len(result) < 2:
                logger.warning("rate_limit.redis.bad_response", extra={"body": str(body)})
                return True, 0.0
            allowed = int(result[0]) == 1
            tokens = float(result[1])
            if allowed:
                return True, 0.0
            return False, self._retry_after(tokens)
        except Exception as exc:  # noqa: BLE001 — fail-open on any transport error
            logger.warning(
                "rate_limit.redis.error", extra={"key": key, "error": str(exc)}
            )
            return True, 0.0

    def _retry_after(self, tokens: float) -> float:
        if tokens >= 1.0 or self._rate_per_second <= 0:
            return 0.0
        return (1.0 - tokens) / self._rate_per_second


# ---------------------------------------------------------------------------
# Factory: pick backend from environment
# ---------------------------------------------------------------------------


def get_limiter(
    *,
    rate_per_minute: float,
    capacity: int,
    settings: Any | None = None,
) -> RateLimiter | None:
    """Choose a backend. Priority: Redis > Postgres > in-memory.

    Returns None when `rate_per_minute <= 0` (rate limiting explicitly disabled).
    """

    if rate_per_minute <= 0 or capacity <= 0:
        return None

    if settings is None:
        from app.core.config import get_settings

        settings = get_settings()

    redis_url = getattr(settings, "upstash_redis_rest_url", None)
    redis_token = getattr(settings, "upstash_redis_rest_token", None)
    if redis_url and redis_token:
        logger.info("rate_limit.backend.redis")
        return RedisTokenBucketLimiter(
            rate_per_minute=rate_per_minute,
            capacity=capacity,
            rest_url=redis_url,
            rest_token=redis_token,
        )

    database_url = getattr(settings, "database_url", None)
    use_postgres = getattr(settings, "rate_limit_use_postgres", False)
    if database_url and use_postgres:
        logger.info("rate_limit.backend.postgres")
        return PostgresTokenBucketLimiter(
            rate_per_minute=rate_per_minute,
            capacity=capacity,
        )

    logger.info("rate_limit.backend.memory")
    return TokenBucketLimiter(rate_per_minute=rate_per_minute, capacity=capacity)
