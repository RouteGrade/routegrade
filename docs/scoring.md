# Scoring function v1 — inputs, weights, and known limits

> Also mirrored in Notion: [Scoring](https://app.notion.com/p/3a5dc99a22218103b997c78bd52b3724). This file is the source of truth; re-sync the Notion copy when this changes materially.

Implemented in `services/api/app/services/scoring.py`. Output is a numeric
score (0–100, one decimal) plus a letter grade shown on the route card and
stored on save.

## Inputs

| Input | Source | Notes |
| --- | --- | --- |
| Elevation gain rate (m/km) | Open-Elevation profile over ≤100 sampled points; positive deltas above a 1 m noise floor | Real measurement. |
| Intersection density (per km) | **Proxy:** OSRM routing maneuvers per km (excluding depart/arrive) | Not true intersection counts — see limits. |

**Sidewalk coverage is excluded from the v1 scoring formula** (see limit 3). It
is still collected on the route (`sidewalk_coverage`) and surfaced in the UI,
but does not affect the numeric score or grade. It is planned to return as a
weighted input once a real sidewalk estimator exists.

## Sub-scores

Each scored input maps to 0–100 through a linear ramp between anchors:

| Input | 100 points at | 0 points at |
| --- | --- | --- |
| Elevation gain | ≤ 5 m/km | ≥ 25 m/km |
| Intersection density | ≤ 2 /km | ≥ 12 /km |

## Weights (preference-dependent)

Sidewalk is no longer weighted in v1. The two remaining signals are weighted by
preference; each row is the v1 elevation/intersection split renormalized to sum
to 1.0 after removing the sidewalk term (computed in code via `_normalize`, so
they stay exact):

| Preference | Elevation | Intersections |
| --- | --- | --- |
| `flat` | 0.706 | 0.294 |
| `quiet` | 0.333 | 0.667 |
| `scenic` | 0.533 | 0.467 |

Each weight row sums to 1.0. The `scenic` row also serves as the fallback
"default weights" the engine applies to any unrecognized preference string.
Note: the **API request default** preference is `quiet` (see
`PlanRequest.preference`), not `scenic` — the two "defaults" are unrelated.

## Grade bands

`A ≥ 85 · B ≥ 70 · C ≥ 55 · D < 55`. Degenerate geometry (zero distance)
scores 0 / D.

### Achievable score range in v1

With sidewalk removed from the formula, the score is a weighted average of two
sub-scores that each span 0–100, and the weights sum to 1.0. The **full 0–100
range is therefore reachable for every preference** (including the fallback
default):

| Preference | Max score | Min score |
| --- | --- | --- |
| `flat` | 100.0 (A) | 0.0 (D) |
| `quiet` | 100.0 (A) | 0.0 (D) |
| `scenic` | 100.0 (A) | 0.0 (D) |

A genuinely great route (flat and low-intersection) now earns a true `A`, and a
bad one can bottom out at `D` — no fixed offset compresses the scale anymore.
The grade bands (below) were re-checked against this range and left unchanged:
`A ≥ 85` is comfortably reachable on the real production path (a route at
≤ 5 m/km climb and ≤ 2 intersections/km scores 100), and a realistic
strong-but-imperfect route still clears 85.

## Known limits (v1)

1. **All weights and anchors are heuristics.** No user feedback has calibrated
   them yet; the feedback loop is an MVP 4 concern. Do not present the grade as
   ground truth.
2. **Intersection density is a maneuver-count proxy.** Long straight roads with
   many cross-streets under-count; complex interchanges over-count. Real
   counts need OSM node analysis.
3. **Sidewalk coverage is excluded from scoring in v1.** OSRM does not surface
   real sidewalk tags, so the old neutral-50 placeholder added no signal and
   only compressed the score range. It has been dropped from the weighting
   entirely; `sidewalk_coverage` is still collected and shown in the UI. An
   Overpass-based estimator can re-introduce it as a weighted input behind the
   existing field without schema changes (re-add its weight and renormalize).
4. **`scenic` has no scenery signal.** It intentionally falls back to the
   balanced default weights; parks/waterfront detection is future work.
5. **Anchors assume urban Toronto.** Trail or suburban contexts will need
   different ramps.
