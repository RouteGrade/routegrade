"""Nominatim-compatible geocoding client.

Phase 0 decision: Nominatim API shape for MVP (keyless, self-hostable). A
managed provider (Mapbox/Google) can be introduced later behind the same
`Geocoder` protocol without touching the planner.
"""

from __future__ import annotations

import httpx

from app.providers.base import AddressNotFound, GeocodeResult, ProviderError


class NominatimGeocoder:
    def __init__(self, base_url: str, *, user_agent: str, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._user_agent = user_agent
        self._timeout = timeout

    def geocode(self, query: str) -> GeocodeResult:
        try:
            response = httpx.get(
                f"{self._base_url}/search",
                params={"q": query, "format": "jsonv2", "limit": 1},
                headers={"User-Agent": self._user_agent},
                timeout=self._timeout,
            )
            response.raise_for_status()
            results = response.json()
        except httpx.HTTPError as exc:
            raise ProviderError("geocoder", f"request failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderError("geocoder", "non-JSON response") from exc

        if not isinstance(results, list):
            raise ProviderError("geocoder", "malformed result payload")
        if not results:
            raise AddressNotFound("geocoder", f"no match for address: {query!r}")

        top = results[0]
        try:
            return GeocodeResult(
                latitude=float(top["lat"]),
                longitude=float(top["lon"]),
                label=str(top.get("display_name") or query),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("geocoder", "malformed result payload") from exc
