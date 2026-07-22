"""RouteGrade scoring function v1.

Inputs (per route):
- elevation gain rate (m of climb per km) — from the elevation provider
- intersection density (maneuvers per km) — proxy from the routing engine

Each input maps to a 0-100 sub-score via a linear ramp between a "great" and a
"poor" anchor, then sub-scores combine through preference-dependent weights.

Sidewalk coverage is intentionally EXCLUDED from the v1 scoring formula. OSRM
does not surface real sidewalk tags, so the previous "neutral 50" placeholder
only compressed the usable score range without adding signal. It is planned to
return as a weighted input once a real sidewalk estimator exists. The
`sidewalk_coverage` value is still collected on the route and surfaced in the
UI; it just does not affect the grade. Weights, anchors, and known limits are
documented in docs/scoring.md; they are v1 heuristics to be tuned with real
feedback.

Grade bands: A >= 85, B >= 70, C >= 55, D below.
"""

from __future__ import annotations

from dataclasses import dataclass

Preference = str  # "quiet" | "flat" | "scenic" (validated at the API boundary)


def _normalize(weights: tuple[float, ...]) -> tuple[float, ...]:
    """Rescale relative weights so they sum to exactly 1.0."""

    total = sum(weights)
    return tuple(w / total for w in weights)


# Relative (elevation, intersection) importance per preference, carried over
# from v1 with the sidewalk term removed and the remainder renormalized to sum
# to 1.0. "scenic" has no scenery signal in v1 — it falls back to the default.
_RAW_WEIGHTS: dict[str, tuple[float, float]] = {
    "flat": (0.60, 0.25),
    "quiet": (0.25, 0.50),
    "scenic": (0.40, 0.35),
}
_RAW_DEFAULT_WEIGHTS = (0.40, 0.35)

# (weight_elevation, weight_intersections) per preference — normalized so each
# row sums to 1.0, restoring the full 0-100 score range.
_WEIGHTS: dict[str, tuple[float, float]] = {
    preference: _normalize(raw) for preference, raw in _RAW_WEIGHTS.items()
}
_DEFAULT_WEIGHTS = _normalize(_RAW_DEFAULT_WEIGHTS)

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
    preference: Preference,
) -> RouteScore:
    """Score one generated route. Degenerate geometry (no distance) grades D.

    Sidewalk coverage is deliberately not a parameter here: it is excluded from
    the v1 formula (see module docstring) and will be re-introduced when a real
    estimator exists.
    """

    if distance_km <= 0:
        return RouteScore(
            score=0.0,
            grade="D",
            elevation_subscore=0.0,
            intersection_subscore=0.0,
        )

    gain_rate = elevation_gain_m / distance_km
    elevation_sub = _ramp(gain_rate, *_ELEVATION_ANCHORS_M_PER_KM)
    intersection_sub = _ramp(intersections_per_km, *_INTERSECTION_ANCHORS_PER_KM)

    w_elev, w_int = _WEIGHTS.get(preference, _DEFAULT_WEIGHTS)
    score = round(w_elev * elevation_sub + w_int * intersection_sub, 1)

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
    )
