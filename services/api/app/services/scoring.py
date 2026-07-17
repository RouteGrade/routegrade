"""RouteGrade scoring function v1.

Inputs (per route):
- elevation gain rate (m of climb per km) — from the elevation provider
- intersection density (maneuvers per km) — proxy from the routing engine
- sidewalk coverage (0..1) — from OSM tags where available, else unknown

Each input maps to a 0-100 sub-score via a linear ramp between a "great" and a
"poor" anchor, then sub-scores combine through preference-dependent weights.
Unknown sidewalk coverage scores a neutral 50 rather than penalizing areas with
sparse OSM tagging. Weights, anchors, and known limits are documented in
docs/scoring.md; they are v1 heuristics to be tuned with real feedback.

Grade bands: A >= 85, B >= 70, C >= 55, D below.
"""

from __future__ import annotations

from dataclasses import dataclass

Preference = str  # "quiet" | "flat" | "scenic" (validated at the API boundary)

# (weight_elevation, weight_intersections, weight_sidewalks) per preference.
# "scenic" has no scenery signal in v1 — it falls back to the balanced default.
_WEIGHTS: dict[str, tuple[float, float, float]] = {
    "flat": (0.60, 0.25, 0.15),
    "quiet": (0.25, 0.50, 0.25),
    "scenic": (0.40, 0.35, 0.25),
}
_DEFAULT_WEIGHTS = (0.40, 0.35, 0.25)

# Linear ramp anchors: (value scoring 100, value scoring 0).
_ELEVATION_ANCHORS_M_PER_KM = (5.0, 25.0)
_INTERSECTION_ANCHORS_PER_KM = (2.0, 12.0)

_GRADE_BANDS: list[tuple[float, str]] = [(85.0, "A"), (70.0, "B"), (55.0, "C")]

# Ignore elevation jitter below this threshold when summing climb — cheap
# smoothing against provider noise on flat terrain.
_GAIN_NOISE_FLOOR_M = 1.0


@dataclass(frozen=True)
class RouteScore:
    score: float  # 0..100, one decimal
    grade: str  # A/B/C/D
    elevation_subscore: float
    intersection_subscore: float
    sidewalk_subscore: float


def elevation_gain_m(elevations: list[float]) -> float:
    """Total positive climb across an elevation profile, noise-floored."""

    gain = 0.0
    for previous, current in zip(elevations, elevations[1:]):
        delta = current - previous
        if delta > _GAIN_NOISE_FLOOR_M:
            gain += delta
    return round(gain, 1)


def _ramp(value: float, best: float, worst: float) -> float:
    """100 at `best` or better, 0 at `worst` or worse, linear between."""

    if value <= best:
        return 100.0
    if value >= worst:
        return 0.0
    return 100.0 * (worst - value) / (worst - best)


def score_route(
    *,
    distance_km: float,
    elevation_gain_m: float,
    intersections_per_km: float,
    sidewalk_coverage: float | None,
    preference: Preference,
) -> RouteScore:
    """Score one generated route. Degenerate geometry (no distance) grades D."""

    if distance_km <= 0:
        return RouteScore(
            score=0.0,
            grade="D",
            elevation_subscore=0.0,
            intersection_subscore=0.0,
            sidewalk_subscore=0.0,
        )

    gain_rate = elevation_gain_m / distance_km
    elevation_sub = _ramp(gain_rate, *_ELEVATION_ANCHORS_M_PER_KM)
    intersection_sub = _ramp(intersections_per_km, *_INTERSECTION_ANCHORS_PER_KM)
    sidewalk_sub = 50.0 if sidewalk_coverage is None else max(0.0, min(1.0, sidewalk_coverage)) * 100.0

    w_elev, w_int, w_side = _WEIGHTS.get(preference, _DEFAULT_WEIGHTS)
    score = round(w_elev * elevation_sub + w_int * intersection_sub + w_side * sidewalk_sub, 1)

    grade = "D"
    for threshold, letter in _GRADE_BANDS:
        if score >= threshold:
            grade = letter
            break

    return RouteScore(
        score=score,
        grade=grade,
        elevation_subscore=round(elevation_sub, 1),
        intersection_subscore=round(intersection_sub, 1),
        sidewalk_subscore=round(sidewalk_sub, 1),
    )
