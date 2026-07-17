# Scoring function v1 — inputs, weights, and known limits

Implemented in `services/api/app/services/scoring.py`. Output is a numeric
score (0–100, one decimal) plus a letter grade shown on the route card and
stored on save.

## Inputs

| Input | Source | Notes |
| --- | --- | --- |
| Elevation gain rate (m/km) | Open-Elevation profile over ≤100 sampled points; positive deltas above a 1 m noise floor | Real measurement. |
| Intersection density (per km) | **Proxy:** OSRM routing maneuvers per km (excluding depart/arrive) | Not true intersection counts — see limits. |
| Sidewalk coverage (0–1) | OSM tags where the engine can provide it | v1 returns *unknown* — scored neutrally. |

## Sub-scores

Each input maps to 0–100 through a linear ramp between anchors:

| Input | 100 points at | 0 points at |
| --- | --- | --- |
| Elevation gain | ≤ 5 m/km | ≥ 25 m/km |
| Intersection density | ≤ 2 /km | ≥ 12 /km |
| Sidewalk coverage | 100% | 0% (unknown → flat 50) |

## Weights (preference-dependent)

| Preference | Elevation | Intersections | Sidewalks |
| --- | --- | --- | --- |
| `flat` | 0.60 | 0.25 | 0.15 |
| `quiet` | 0.25 | 0.50 | 0.25 |
| `scenic` (= default) | 0.40 | 0.35 | 0.25 |

## Grade bands

`A ≥ 85 · B ≥ 70 · C ≥ 55 · D < 55`. Degenerate geometry (zero distance)
scores 0 / D.

## Known limits (v1)

1. **All weights and anchors are heuristics.** No user feedback has calibrated
   them yet; the feedback loop is an MVP 4 concern. Do not present the grade as
   ground truth.
2. **Intersection density is a maneuver-count proxy.** Long straight roads with
   many cross-streets under-count; complex interchanges over-count. Real
   counts need OSM node analysis.
3. **Sidewalk coverage is unscored in practice.** OSRM does not surface
   sidewalk tags, so v1 always applies the neutral 50. An Overpass-based
   estimator can replace it behind the existing `sidewalk_coverage` field
   without schema changes.
4. **`scenic` has no scenery signal.** It intentionally falls back to the
   balanced default weights; parks/waterfront detection is future work.
5. **Anchors assume urban Toronto.** Trail or suburban contexts will need
   different ramps.
