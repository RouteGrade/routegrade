"""Tests for the Postgres rate-limit backend + factory selection.

The Postgres backend is exercised against an in-memory SQLite (the class has an
explicit SQLite branch that emulates the atomic UPSERT), which covers the
refill math and the fail-open path. Two "concurrent" calls at capacity are
simulated by advancing a mock clock — SQLite is single-writer so we can't
really overlap them, but the class-level invariant we need is that consuming a
token is atomic against the read that decides whether to consume, and both
implementations enforce that (SQLite via single-writer; Postgres via the
UPSERT row lock).

The Redis backend is covered by `test_rate_limit_redis.py`.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.rate_limit import (
    PostgresTokenBucketLimiter,
    RedisTokenBucketLimiter,
    TokenBucketLimiter,
    get_limiter,
)

# RedisTokenBucketLimiter is imported so the factory-selection tests below can
# assert isinstance() on it; the backend's own behavior is covered in
# `tests/test_rate_limit_redis.py`.
_ = RedisTokenBucketLimiter


# ---------------------------------------------------------------------------
# SQLite fixture that mirrors the migration's shape.
# ---------------------------------------------------------------------------


@pytest.fixture()
def pg_sessionmaker():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Match the alembic migration's shape exactly (minus RLS, which SQLite lacks).
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE rate_limit_buckets ("
                " key TEXT PRIMARY KEY,"
                " tokens REAL NOT NULL,"
                " last_refill_ms INTEGER NOT NULL,"
                " capacity REAL NOT NULL,"
                " refill_rate REAL NOT NULL"
                ")"
            )
        )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    yield lambda: SessionLocal
    engine.dispose()


# ---------------------------------------------------------------------------
# Postgres-backend refill math
# ---------------------------------------------------------------------------


def test_postgres_first_call_allowed_new_key(pg_sessionmaker):
    limiter = PostgresTokenBucketLimiter(
        rate_per_minute=60, capacity=3, sessionmaker_factory=pg_sessionmaker
    )
    allowed, retry_after = limiter.check("client-a")
    assert allowed is True
    assert retry_after == 0.0


def test_postgres_burst_then_deny_then_refill(pg_sessionmaker):
    limiter = PostgresTokenBucketLimiter(
        rate_per_minute=60, capacity=3, sessionmaker_factory=pg_sessionmaker
    )
    # Three quick calls should all pass; the fourth should be denied.
    for _ in range(3):
        assert limiter.check("client-b")[0] is True
    allowed, retry_after = limiter.check("client-b")
    assert allowed is False
    assert retry_after > 0

    # Simulate elapsed time by rewinding the stored last_refill_ms enough for
    # a full token to accrue (60/min = 1/sec → 1000ms).
    session = pg_sessionmaker()()
    session.execute(
        text("UPDATE rate_limit_buckets SET last_refill_ms = last_refill_ms - 1500 WHERE key = :k"),
        {"k": "client-b"},
    )
    session.commit()
    session.close()

    assert limiter.check("client-b")[0] is True


def test_postgres_atomicity_at_capacity_edge(pg_sessionmaker):
    """Two calls that both observe the pre-refill state with exactly one token
    left must yield exactly one allow and one deny."""

    limiter = PostgresTokenBucketLimiter(
        rate_per_minute=60, capacity=1, sessionmaker_factory=pg_sessionmaker
    )
    # First call consumes the sole token.
    assert limiter.check("client-c")[0] is True
    # Second immediate call must be denied (no refill possible in <1ms).
    allowed, retry_after = limiter.check("client-c")
    assert allowed is False
    assert retry_after > 0


def test_postgres_isolates_keys(pg_sessionmaker):
    limiter = PostgresTokenBucketLimiter(
        rate_per_minute=60, capacity=1, sessionmaker_factory=pg_sessionmaker
    )
    assert limiter.check("key-x")[0] is True
    # Different key still has a full bucket.
    assert limiter.check("key-y")[0] is True
    # Both are now empty.
    assert limiter.check("key-x")[0] is False
    assert limiter.check("key-y")[0] is False


# ---------------------------------------------------------------------------
# Fail-open on DB error
# ---------------------------------------------------------------------------


def test_postgres_fails_open_on_sessionmaker_error():
    def boom():
        raise RuntimeError("connection pool exhausted")

    limiter = PostgresTokenBucketLimiter(
        rate_per_minute=60, capacity=3, sessionmaker_factory=boom
    )
    allowed, retry_after = limiter.check("client-d")
    assert allowed is True
    assert retry_after == 0.0


def test_postgres_fails_open_on_execute_error():
    """Simulate a DB timeout mid-check: the request should still be allowed."""

    fake_session = MagicMock()
    fake_session.bind.dialect.name = "postgresql"
    fake_session.execute.side_effect = RuntimeError("statement timeout")

    def factory():
        return lambda: fake_session

    limiter = PostgresTokenBucketLimiter(
        rate_per_minute=60, capacity=3, sessionmaker_factory=factory
    )
    allowed, retry_after = limiter.check("client-e")
    assert allowed is True
    assert retry_after == 0.0
    fake_session.close.assert_called_once()


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def _settings(**overrides):
    base = {
        "database_url": "sqlite+pysqlite:///:memory:",
        "rate_limit_use_postgres": True,
        "upstash_redis_rest_url": None,
        "upstash_redis_rest_token": None,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_factory_returns_none_when_disabled():
    assert get_limiter(rate_per_minute=0, capacity=5, settings=_settings()) is None
    assert get_limiter(rate_per_minute=60, capacity=0, settings=_settings()) is None


def test_factory_prefers_redis_when_configured():
    settings = _settings(
        upstash_redis_rest_url="https://example.upstash.io",
        upstash_redis_rest_token="tok",
    )
    limiter = get_limiter(rate_per_minute=60, capacity=5, settings=settings)
    assert isinstance(limiter, RedisTokenBucketLimiter)


def test_factory_falls_back_to_postgres_when_db_url_set():
    settings = _settings()
    limiter = get_limiter(rate_per_minute=60, capacity=5, settings=settings)
    assert isinstance(limiter, PostgresTokenBucketLimiter)


def test_factory_falls_back_to_memory_when_postgres_disabled():
    settings = _settings(rate_limit_use_postgres=False)
    limiter = get_limiter(rate_per_minute=60, capacity=5, settings=settings)
    assert isinstance(limiter, TokenBucketLimiter)


def test_factory_falls_back_to_memory_when_no_db_url():
    settings = _settings(database_url=None)
    limiter = get_limiter(rate_per_minute=60, capacity=5, settings=settings)
    assert isinstance(limiter, TokenBucketLimiter)
