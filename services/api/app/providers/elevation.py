"""Open-Elevation-compatible elevation client.

Phase 0 decision: Open-Elevation initially (keyless, self-hostable); migrate to
SRTM tiles in PostGIS if volume outgrows it.
"""

from __future__ import annotations

import httpx

from app.providers.base import ProviderError

# Providers cap request sizes; sample long geometries down to this many points.
_MAX_SAMPLE_POINTS = 100


def sample_coordinates(coordinates: list[list[float]], max_points: int = _MAX_SAMPLE_POINTS) -> list[list[float]]:
    """Evenly subsample a coordinate list, always keeping first and last."""

    if len(coordinates) <= max_points:
        return coordinates
    step = (len(coordinates) - 1) / (max_points - 1)
    return [coordinates[round(i * step)] for i in range(max_points)]


class OpenElevationClient:
    def __init__(self, base_url: str, *, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def elevations(self, coordinates: list[list[float]]) -> list[float]:
        locations = [
            {"latitude": lat, "longitude": lng} for lng, lat in (c[:2] for c in coordinates)
        ]
        try:
            response = httpx.post(
                f"{self._base_url}/api/v1/lookup",
                json={"locations": locations},
                timeout=self._timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise ProviderError("elevation", f"request failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderError("elevation", "non-JSON response") from exc

        results = payload.get("results")
        if not isinstance(results, list) or len(results) != len(locations):
            raise ProviderError("elevation", "result count mismatch")
        try:
            return [float(r["elevation"]) for r in results]
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("elevation", "malformed elevation payload") from exc
