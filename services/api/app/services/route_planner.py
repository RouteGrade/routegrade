"""Route planning orchestration: geocode -> generate -> elevation -> score."""

from __future__ import annotations

import logging
import uuid

from app.providers.base import (
    ElevationProvider,
    GeocodeResult,
    Geocoder,
    ProviderError,
    RoutingEngine,
)
from app.providers.elevation import sample_coordinates
from app.schemas.routes import (
    LineStringGeometry,
    PlannedRoute,
    PlanRequest,
    PlanResponse,
    StartPoint,
)
from app.services import scoring

logger = logging.getLogger(__name__)

# Seed bearings spread candidate loops around the start so the user gets
# genuinely different geometries, not three copies of the same block.
_CANDIDATE_BEARINGS_DEG = (20.0, 140.0, 260.0)
_CANDIDATE_LABELS = ("North loop", "East loop", "West loop")


class RoutePlanner:
    def __init__(
        self,
        *,
        geocoder: Geocoder,
        routing: RoutingEngine,
        elevation: ElevationProvider,
        distance_tolerance: float = 0.10,
    ) -> None:
        self._geocoder = geocoder
        self._routing = routing
        self._elevation = elevation
        self._tolerance = distance_tolerance

    def plan(self, request: PlanRequest) -> PlanResponse:
        start = self._resolve_start(request)

        candidates: list[PlannedRoute] = []
        last_error: ProviderError | None = None
        for bearing, label in zip(_CANDIDATE_BEARINGS_DEG, _CANDIDATE_LABELS):
            try:
                candidates.append(self._build_candidate(start, request, bearing, label))
            except ProviderError as exc:
                # One failed bearing shouldn't sink the request; surface only
                # if every candidate fails.
                logger.warning("candidate generation failed (bearing=%s): %s", bearing, exc)
                last_error = exc

        if not candidates:
            raise last_error or ProviderError("routing", "no candidates generated")

        # Prefer in-tolerance routes, then higher scores.
        candidates.sort(key=lambda r: (not r.within_tolerance, -r.score))

        return PlanResponse(
            start=StartPoint(
                latitude=start.latitude, longitude=start.longitude, label=start.label
            ),
            requested_distance_km=request.distance_km,
            preference=request.preference,
            distance_tolerance=self._tolerance,
            routes=candidates,
        )

    def _resolve_start(self, request: PlanRequest) -> GeocodeResult:
        if request.latitude is not None and request.longitude is not None:
            label = (request.address or "").strip() or (
                f"{request.latitude:.4f}, {request.longitude:.4f}"
            )
            return GeocodeResult(
                latitude=request.latitude, longitude=request.longitude, label=label
            )
        assert request.address is not None  # guaranteed by PlanRequest validation
        return self._geocoder.geocode(request.address.strip())

    def _build_candidate(
        self,
        start: GeocodeResult,
        request: PlanRequest,
        bearing_deg: float,
        label: str,
    ) -> PlannedRoute:
        generated = self._routing.generate_loop(
            latitude=start.latitude,
            longitude=start.longitude,
            distance_km=request.distance_km,
            bearing_deg=bearing_deg,
        )

        profile = self._elevation.elevations(sample_coordinates(generated.coordinates))
        gain = scoring.elevation_gain_m(profile)

        result = scoring.score_route(
            distance_km=generated.distance_km,
            elevation_gain_m=gain,
            intersections_per_km=generated.intersections_per_km,
            preference=request.preference,
        )

        deviation = abs(generated.distance_km - request.distance_km) / request.distance_km
        return PlannedRoute(
            id=uuid.uuid4(),
            name=f"{label} · {generated.distance_km:.1f} km",
            geometry=LineStringGeometry(type="LineString", coordinates=generated.coordinates),
            distance_km=round(generated.distance_km, 2),
            elevation_gain_m=gain,
            intersections_per_km=round(generated.intersections_per_km, 2),
            sidewalk_coverage=generated.sidewalk_coverage,
            score=result.score,
            grade=result.grade,  # type: ignore[arg-type]
            within_tolerance=deviation <= self._tolerance,
            provider=generated.provider,
        )
