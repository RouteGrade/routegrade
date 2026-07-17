"""Minimal in-process per-key token-bucket rate limiter.

Deliberately dependency-free: good enough for a single API instance (the MVP 4
deployment shape). If the API ever scales horizontally, swap the storage for
Redis behind the same `check()` interface — callers won't change.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass


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
