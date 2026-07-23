"""OSRM-backed loop generation.

Phase 0 decision: OSRM HTTP API (self-hosted in production, so the `foot`
profile is available; the public demo server only serves `driving` and is fine
for smoke-testing).

Loop strategy: project two waypoints from the start at `radius` km, 60 degrees
apart around a seed bearing, and route start -> w1 -> w2 -> start. The straight
line perimeter of that triangle is ~3x the radius; the road network inflates it,
so we iteratively rescale the radius against the actual routed distance until
the loop lands within tolerance of the requested distance (or we run out of
attempts and keep the closest result).
"""

from __future__ import annotations

import math

import httpx

from app.providers.base import GeneratedRoute, ProviderError

_EARTH_RADIUS_KM = 6371.0
# First guess: triangle perimeter ~= 3 * radius, plus ~15% road-network detour.
_INITIAL_PERIMETER_FACTOR = 3.4
_MAX_ATTEMPTS = 4

# OSRM's match service caps the number of trace coordinates per request (100 on
# the reference server). A finger-drawn path can carry far more points than
# that and than map-matching needs, so we thin it to at most this many,
# always keeping the first and last point.
_MATCH_MAX_POINTS = 100


def _downsample(coordinates: list[list[float]], max_points: int) -> list[list[float]]:
    """Evenly thin a coordinate list to <= max_points, keeping the endpoints."""

    n = len(coordinates)
    if n <= max_points:
        return coordinates
    # Pick evenly spaced indices across the range, endpoints inclusive.
    step = (n - 1) / (max_points - 1)
    idx = sorted({round(i * step) for i in range(max_points)})
    return [coordinates[i] for i in idx]


def _destination(lat: float, lng: float, bearing_deg: float, distance_km: float) -> tuple[float, float]:
    """Great-circle destination point from (lat, lng) along a bearing."""

    bearing = math.radians(bearing_deg)
    angular = distance_km / _EARTH_RADIUS_KM
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)

    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(bearing)
    )
    lng2 = lng1 + math.atan2(
        math.sin(bearing) * math.sin(angular) * math.cos(lat1),
        math.cos(angular) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lng2)


class OSRMRoutingEngine:
    def __init__(self, base_url: str, *, profile: str = "foot", timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._profile = profile
        self._timeout = timeout

    def generate_loop(
        self, *, latitude: float, longitude: float, distance_km: float, bearing_deg: float
    ) -> GeneratedRoute:
        radius_km = distance_km / _INITIAL_PERIMETER_FACTOR
        best: GeneratedRoute | None = None

        for _ in range(_MAX_ATTEMPTS):
            route = self._route_triangle(latitude, longitude, radius_km, bearing_deg)
            if best is None or abs(route.distance_km - distance_km) < abs(
                best.distance_km - distance_km
            ):
                best = route
            if route.distance_km <= 0:
                break
            error = route.distance_km / distance_km
            if 0.95 <= error <= 1.05:
                break
            # Rescale the search radius by how far off the routed loop came out.
            radius_km = max(0.05, radius_km / error)

        assert best is not None
        return best

    def _route_triangle(
        self, lat: float, lng: float, radius_km: float, bearing_deg: float
    ) -> GeneratedRoute:
        w1_lat, w1_lng = _destination(lat, lng, bearing_deg, radius_km)
        w2_lat, w2_lng = _destination(lat, lng, bearing_deg + 60.0, radius_km)
        coords = f"{lng},{lat};{w1_lng},{w1_lat};{w2_lng},{w2_lat};{lng},{lat}"

        try:
            response = httpx.get(
                f"{self._base_url}/route/v1/{self._profile}/{coords}",
                params={
                    "geometries": "geojson",
                    "overview": "full",
                    "steps": "true",
                    "continue_straight": "false",
                },
                timeout=self._timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise ProviderError("routing", f"request failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderError("routing", "non-JSON response") from exc

        if payload.get("code") != "Ok" or not payload.get("routes"):
            raise ProviderError("routing", f"no route: {payload.get('code', 'unknown')}")

        route = payload["routes"][0]
        try:
            coordinates = route["geometry"]["coordinates"]
            distance_km = float(route["distance"]) / 1000.0
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderError("routing", "malformed route payload") from exc

        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ProviderError("routing", "degenerate route geometry")

        # Intersection-density proxy: routing maneuvers per km, excluding the
        # bookkeeping depart/arrive steps. Real intersection counts need OSM
        # node analysis — documented limit in docs/scoring.md.
        maneuvers = 0
        for leg in route.get("legs", []):
            for step in leg.get("steps", []):
                if step.get("maneuver", {}).get("type") not in {"depart", "arrive"}:
                    maneuvers += 1
        intersections_per_km = maneuvers / distance_km if distance_km > 0 else 0.0

        return GeneratedRoute(
            coordinates=[[float(c[0]), float(c[1])] for c in coordinates],
            distance_km=distance_km,
            intersections_per_km=intersections_per_km,
            provider="osrm",
            sidewalk_coverage=None,
        )

    def snap_trace(self, coordinates: list[list[float]]) -> GeneratedRoute:
        points = _downsample(coordinates, _MATCH_MAX_POINTS)
        if len(points) < 2:
            raise ProviderError("routing", "trace needs at least two points")
        coord_str = ";".join(f"{lng},{lat}" for lng, lat in points)

        try:
            response = httpx.get(
                f"{self._base_url}/match/v1/{self._profile}/{coord_str}",
                params={
                    "geometries": "geojson",
                    "overview": "full",
                    "steps": "true",
                    # `tidy` lets OSRM clean up noisy, densely-sampled input
                    # (exactly what a finger drag produces) before matching.
                    "tidy": "true",
                },
                timeout=self._timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise ProviderError("routing", f"match request failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderError("routing", "non-JSON match response") from exc

        if payload.get("code") != "Ok" or not payload.get("matchings"):
            raise ProviderError("routing", f"no match: {payload.get('code', 'unknown')}")

        # A trace can split into several matchings (gaps the matcher won't
        # bridge); concatenate them in order and sum their signals.
        merged: list[list[float]] = []
        distance_m = 0.0
        maneuvers = 0
        for matching in payload["matchings"]:
            try:
                geometry = matching["geometry"]["coordinates"]
                distance_m += float(matching["distance"])
            except (KeyError, TypeError, ValueError) as exc:
                raise ProviderError("routing", "malformed match payload") from exc
            for c in geometry:
                merged.append([float(c[0]), float(c[1])])
            for leg in matching.get("legs", []):
                for step in leg.get("steps", []):
                    if step.get("maneuver", {}).get("type") not in {"depart", "arrive"}:
                        maneuvers += 1

        if len(merged) < 2:
            raise ProviderError("routing", "degenerate matched geometry")

        distance_km = distance_m / 1000.0
        intersections_per_km = maneuvers / distance_km if distance_km > 0 else 0.0
        return GeneratedRoute(
            coordinates=merged,
            distance_km=distance_km,
            intersections_per_km=intersections_per_km,
            provider="osrm-match",
            sidewalk_coverage=None,
        )
