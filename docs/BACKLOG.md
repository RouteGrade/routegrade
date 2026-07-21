# Company Backlog

Prioritized work queue for the autonomous heartbeat. The heartbeat works items
top-to-bottom. Items marked `[founder]` need founder-side accounts/dashboards.

Format: `- [ ] P<1-3> <item> — owner: <agent> (context/links)`

## Milestone: MS6 (all three scopes, order C → A → B — see milestones/MS6.md)

## Now (Phase C kickoff + carried-over P1s)

- [ ] P1 Add dbt models for runs: `routegrade_ops.runs` source, `stg_runs`
  dropping GPS trace/PII (mirroring `stg_saved_routes`), `dim_runs` +
  `fct_runs_daily` marts with schema tests — owner: director-of-data
- [ ] P1 Security review of the MVP 5 surface: verify owner-only RLS on
  `public.runs`, request-size limits on GPS trace payloads, rate limiting on
  runs endpoints — owner: security-engineer
- [ ] P1 CI: GitHub Actions running `uv run pytest` + `ruff check`
  (services/api), `pnpm lint` + `pnpm build` (apps/web), `dbt parse`
  (analytics) on every push — owner: devops-engineer
- [ ] P1 Redis/Upstash rate limiter backend behind the existing `check()`
  interface in `app/core/rate_limit.py`, env-configured with in-memory
  fallback; extend coverage to runs + saved-routes endpoints — owner:
  staff-engineer (activation blocked `[founder]` Upstash creds)
- [ ] P1 OSRM cutover readiness: make base URL + profile fully env-driven,
  verify loop tolerance logic against a `foot` profile locally (docker
  one-shot if feasible), document the cutover runbook — owner: cto
  (activation blocked `[founder]` host)

## Next (Phase C completion)

- [ ] P2 `route_plans` cache table (Alembic additive migration) keyed on
  `(start, distance, preference)` — owner: staff-engineer
- [ ] P2 Tile provider style URL behind env var (OpenFreeMap default for dev),
  attribution component — owner: staff-engineer (activation blocked
  `[founder]` API key)
- [ ] P2 Error tracking + uptime monitoring (Sentry free tier + health
  pinger), alert path documented — owner: devops-engineer (may need
  `[founder]` Sentry account)
- [ ] P2 Scripted post-deploy smoke test (health, live plan, CORS, auth
  callback, save + run persist) — owner: qa-lead
- [ ] P2 Run-tracker regression suite via `?simulate=1` — owner: qa-engineer

## Later (Phase A, then Phase B — expand when phases open)

- [ ] P3 Phase A: Overpass sidewalk estimator; node-degree intersection
  density; scenery signal; `route_feedback` migration + API + UI prompts;
  grade explanation UI; calibration dbt models; scoring v2 docs + tests
  (geometry-dependent items gated on OSRM `foot` cutover)
- [ ] P3 Phase B: public route pages + visibility; OG images; opt-in run
  sharing; PostGIS + `/v1/routes/nearby`; discover page; abuse basics;
  share analytics (gated on tile provider + Phase A explanation UI)

## Icebox

## Done

- [x] P1 Fix doc staleness — README to MVP 5 + new `milestones/MS5.md`
  (2026-07-21 run 2, technical-writer; branch
  `heartbeat/2026-07-21-doc-staleness`, awaiting founder merge)
- [x] P1 Draft MVP 6 scope proposal — approved same day: ALL THREE, C → A → B
  (2026-07-21 run 2, head-of-product)
- [x] P1 Groom this backlog against the current milestone (2026-07-21 run 1,
  head-of-product)
