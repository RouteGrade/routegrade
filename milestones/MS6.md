# MS6 — Trustworthy grades on a real foundation, then sharing

**Status:** in progress (started 2026-07-21)
**Decision:** founder approved all three proposed scopes (A: scoring v2 +
feedback loop, B: social/sharing, C: production hardening) on 2026-07-21 —
see `docs/DECISIONS.md`. Execution order **C → A → B**.

Full option text with pitches, deliverables, effort, and risks: git history
commit `7132c6a` (`docs/PENDING_APPROVALS.md` at that revision).

## Phase C — Production hardening (~4-6 runs)

Make the existing claim true: self-hosted OSRM `foot` cutover (code-side ready,
founder provisions host), hosted tile provider behind env var, Redis/Upstash
rate limiter behind the existing `check()` interface (extended to runs +
saved-routes endpoints), `route_plans` cache table, GitHub Actions CI, error
tracking + uptime monitoring, scripted post-deploy smoke test.

## Phase A — Scoring v2 + feedback loop (~5-7 runs)

Make the grade the product: Overpass sidewalk-coverage estimator, real
intersection density (OSM node-degree), scenery signal for `scenic`,
`route_feedback` table + `POST /v1/routes/{id}/feedback` + UI prompts, grade
explanation UI (per-factor sub-scores), calibration dbt models joining
feedback + runs against stored scores, scoring v2 weights revision documented
in `docs/scoring.md`, regression tests throughout.

Hard gate: scoring calibration work waits until the OSRM `foot` cutover is
live (calibrating on driving geometry calibrates the wrong thing). Code that
doesn't depend on geometry (feedback capture, explanation UI) may proceed.

## Phase B — Social & sharing (~6-8 runs)

Distribution: public route pages `/routes/{slug}` with owner-controlled
visibility, share affordances + OG images, opt-in shareable run summaries
(GPS-trace privacy: private by default everywhere), PostGIS + `GET
/v1/routes/nearby`, discover page, abuse basics, share/view analytics.

Hard gates: tile provider live (public pages can't ship on OpenFreeMap) and
Phase A's explanation UI shipped (public pages show defensible grades).

## Founder-side dependencies

Tracked in `docs/PENDING_APPROVALS.md` § Founder actions needed: Supabase
redirect allow-list (urgent), OSRM host, Upstash Redis, tile provider key.
