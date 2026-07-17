"""Shared provider types and protocols for route planning."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


class ProviderError(RuntimeError):
    """A provider call failed (network, upstream error, or unusable payload)."""

    def __init__(self, provider: str, message: str) -> None:
        super().__init__(f"{provider}: {message}")
        self.provider = provider


class AddressNotFound(ProviderError):
    """The geocoder answered but found no match — a caller problem, not an outage."""


@dataclass(frozen=True)
class GeocodeResult:
    """A resolved starting point."""

    latitude: float
    longitude: float
    label: str


@dataclass(frozen=True)
class GeneratedRoute:
    """A raw candidate loop from the routing engine, before scoring.

    `coordinates` is a GeoJSON-order list of [longitude, latitude] pairs.
    `intersections_per_km` is a proxy derived from routing maneuvers — see
    docs/scoring.md for its limits.
    """

    coordinates: list[list[float]]
    distance_km: float
    intersections_per_km: float
    provider: str = "osrm"
    # Fraction of the route with mapped sidewalks, when the engine can tell.
    sidewalk_coverage: float | None = field(default=None)


class Geocoder(Protocol):
    def geocode(self, query: str) -> GeocodeResult: ...


class RoutingEngine(Protocol):
    def generate_loop(
        self, *, latitude: float, longitude: float, distance_km: float, bearing_deg: float
    ) -> GeneratedRoute: ...


class ElevationProvider(Protocol):
    def elevations(self, coordinates: list[list[float]]) -> list[float]:
        """Metres above sea level for each [lng, lat] coordinate, same order."""
        ...
