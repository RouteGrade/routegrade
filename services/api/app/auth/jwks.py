"""JWKS fetch + cache for Supabase JWT signature verification."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx
from jwt import PyJWK, PyJWKSet


@dataclass
class _CacheEntry:
    jwks: PyJWKSet
    fetched_at: float


class JWKSClient:
    """Thread-safe JWKS cache with `kid`-miss refresh.

    - Refreshes on TTL expiry.
    - Refreshes on cache miss (unknown `kid`) at most once per `min_refresh_interval`.
    - Uses a bounded HTTP timeout so a broken JWKS endpoint cannot hang requests.
    """

    def __init__(
        self,
        jwks_url: str,
        *,
        ttl_seconds: float = 600.0,
        min_refresh_interval: float = 5.0,
        http_timeout: float = 3.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._jwks_url = jwks_url
        self._ttl = ttl_seconds
        self._min_refresh_interval = min_refresh_interval
        self._http_timeout = http_timeout
        self._client = client
        self._lock = threading.Lock()
        self._cache: _CacheEntry | None = None
        self._last_refresh_attempt: float = 0.0

    def get_signing_key(self, kid: str | None) -> PyJWK:
        """Return the signing key matching `kid`, refreshing on miss.

        Raises KeyError if the key is not found after a refresh attempt.
        """

        entry = self._cache
        now = time.monotonic()

        # Fresh cache and known kid? Fast path.
        if entry is not None and now - entry.fetched_at < self._ttl:
            key = _find_key(entry.jwks, kid)
            if key is not None:
                return key

        # Miss or stale — refresh (rate-limited).
        entry = self._refresh(now)
        key = _find_key(entry.jwks, kid)
        if key is None:
            raise KeyError(f"No JWKS key found for kid={kid!r}")
        return key

    def _refresh(self, now: float) -> _CacheEntry:
        with self._lock:
            # Another thread may have just refreshed.
            entry = self._cache
            if (
                entry is not None
                and now - entry.fetched_at < self._ttl
                and now - self._last_refresh_attempt < self._min_refresh_interval
            ):
                return entry

            self._last_refresh_attempt = now
            payload = self._fetch()
            new_entry = _CacheEntry(jwks=PyJWKSet.from_dict(payload), fetched_at=now)
            self._cache = new_entry
            return new_entry

    def _fetch(self) -> dict[str, Any]:
        client = self._client or httpx.Client(timeout=self._http_timeout)
        try:
            resp = client.get(self._jwks_url, timeout=self._http_timeout)
            resp.raise_for_status()
            return resp.json()
        finally:
            if self._client is None:
                client.close()


def _find_key(jwks: PyJWKSet, kid: str | None) -> PyJWK | None:
    if kid is None:
        # If the token has no kid and the JWKS has exactly one key, use it.
        if len(jwks.keys) == 1:
            return jwks.keys[0]
        return None
    for key in jwks.keys:
        if key.key_id == kid:
            return key
    return None
