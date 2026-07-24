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

# A finger-drawn path carries far more points than routing needs. Routing
# *through* every jittery point makes OSRM double back trying to hit each one;
# thinning to a handful of waypoints yields a smooth on-road route that still
# follows the drawn shape. (OSRM also caps waypoints per /route request.)
_SNAP_MAX_WAYPOINTS = 25


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
        return self._route_waypoints(
            [[lng, lat], [w1_lng, w1_lat], [w2_lng, w2_lat], [lng, lat]],
            provider="osrm",
        )

    def snap_trace(self, coordinates: list[list[float]]) -> GeneratedRoute:
        """Snap a hand-drawn trace to roads by routing *through* its points.

        OSRM's /match service rejects imprecise freehand traces (they don't hug
        the road network closely enough — it returns NoMatch), so instead we
        thin the drawing to a handful of waypoints and route between them along
        real roads with /route, the same call the loop planner uses. That
        reliably yields an on-road, gradeable geometry for any drawing.
        """
        waypoints = _downsample(coordinates, _SNAP_MAX_WAYPOINTS)
        if len(waypoints) < 2:
            raise ProviderError("routing", "trace needs at least two points")
        return self._route_waypoints(waypoints, provider="osrm-drawn")

    def nearest(self, lng: float, lat: float) -> list[float]:
        """Snap a raw [lng, lat] onto the nearest point of the routable network.

        Powers intent-based cursor snapping while drawing: the user's cursor
        needn't sit exactly on a path — OSRM's /nearest returns the closest
        point on a routable way for the active profile.
        """

        try:
            response = httpx.get(
                f"{self._base_url}/nearest/v1/{self._profile}/{lng},{lat}",
                params={"number": "1"},
                timeout=self._timeout,
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError as exc:
            raise ProviderError("routing", f"nearest request failed: {exc}") from exc
        except ValueError as exc:
            raise ProviderError("routing", "non-JSON nearest response") from exc

        if payload.get("code") != "Ok" or not payload.get("waypoints"):
            raise ProviderError("routing", f"no snap: {payload.get('code', 'unknown')}")
        try:
            location = payload["waypoints"][0]["location"]
            snapped = [float(location[0]), float(location[1])]
        except (KeyError, TypeError, ValueError, IndexError) as exc:
            raise ProviderError("routing", "malformed nearest payload") from exc
        return snapped

    def route_segment(
        self, start: list[float], end: list[float]
    ) -> tuple[list[list[float]], float]:
        """Route one segment between two points; returns (geometry, distance_km).

        The building block of a drawn route: each committed drag sample becomes a
        waypoint, and consecutive waypoints are joined by one of these segments.
        Reuses _route_waypoints; the full route is scored later via /custom.
        """

        generated = self._route_waypoints([start, end], provider="osrm-segment")
        return generated.coordinates, generated.distance_km

    def _route_waypoints(
        self, waypoints: list[list[float]], *, provider: str
    ) -> GeneratedRoute:
        """Route through waypoints along real roads and score the result."""

        coord_str = ";".join(f"{lng},{lat}" for lng, lat in waypoints)
        try:
            response = httpx.get(
                f"{self._base_url}/route/v1/{self._profile}/{coord_str}",
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
            provider=provider,
            sidewalk_coverage=None,
        )
