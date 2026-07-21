# Company Backlog

Prioritized work queue for the autonomous heartbeat. The heartbeat works items
top-to-bottom. Items marked `[needs-approval]` are never executed autonomously —
they go to `PENDING_APPROVALS.md` instead.

Format: `- [ ] P<1-3> <item> — owner: <agent> (context/links)`

## Milestone status (as of 2026-07-21 grooming)

Code is at **MVP 5** (live run tracking with GPS, splits, audio cues, `public.runs`
table — commit `da6bf78`) on top of MVP 4's public Vercel deployment. Docs lag
reality (README says MVP 3; `milestones/` stops at MS4). MVP 6 is undefined —
scope proposal pending founder decision.

## Now

- [ ] P1 Add dbt models for runs: `routegrade_ops.runs` source, `stg_runs`
  dropping GPS trace/PII (mirroring `stg_saved_routes`), `dim_runs` +
  `fct_runs_daily` marts with schema tests — owner: director-of-data
  (`public.runs` shipped in MVP 5 with zero analytics coverage)
- [ ] P1 Security review of the MVP 5 surface: verify owner-only RLS on
  `public.runs`, add/verify request-size limits on GPS trace payloads to
  `/v1/users/me/runs`, confirm runs endpoints are rate-limited — owner:
  security-engineer (large user-supplied geometry, shipped fast, never audited)
## Next

- [ ] P2 Add a `route_plans` cache table (Alembic additive migration) keyed on
  `(start, distance, preference)` so identical plan requests reuse computed
  routes — owner: staff-engineer (pre-launch requirement in
  `docs/routing-setup.md`; cuts provider load and 10-20s repeat latency)
- [ ] P2 Add CI: GitHub Actions running `uv run pytest` + `ruff check`
  (services/api), `pnpm lint` + `pnpm build` (apps/web), `dbt parse`
  (analytics) on every push — owner: devops-engineer (no `.github/workflows/`
  exists; 67+ tests never run automatically)
- [ ] P2 Implement the Overpass-based sidewalk-coverage estimator behind the
  existing `sidewalk_coverage` field in `app/services/scoring.py`
  (env-configurable endpoint, graceful fallback to neutral 50) — owner:
  staff-engineer (scoring.md known-limit #3: sidewalks always score flat 50)
- [ ] P2 Run-tracker regression suite: exercise `?simulate=1` virtual-runner for
  pause/resume, off-route guidance, finish/summary, persistence edge cases —
  owner: qa-engineer (684-line `run-tracker.tsx` has backend tests only)

## Later

- [ ] P3 Replace maneuver-count intersection proxy with real OSM node-degree
  analysis for intersection density — owner: staff-engineer (scoring.md
  known-limit #2)
- [ ] P3 Production smoke-test checklist (health, live plan, CORS, auth
  callback, save + run persist), scripted and runnable after each deploy —
  owner: qa-lead

## Icebox

## Done

- [x] P1 Fix doc staleness — README to MVP 5 + new `milestones/MS5.md`
  (2026-07-21 run 2, technical-writer; branch
  `heartbeat/2026-07-21-doc-staleness`, awaiting founder merge)
- [x] P1 Draft MVP 6 scope proposal — filed in `PENDING_APPROVALS.md` with 3
  options, recommendation: Scoring v2 gated on OSRM foot profile
  (2026-07-21 run 2, head-of-product)
- [x] P1 Groom this backlog against the current milestone (2026-07-21 run 1,
  head-of-product)
