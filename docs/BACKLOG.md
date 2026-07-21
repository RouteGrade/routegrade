# Company Backlog

Prioritized work queue for the autonomous heartbeat. The heartbeat works items
top-to-bottom. Items marked `[founder]` need founder-side accounts/dashboards.

Format: `- [ ] P<1-3> <item> — owner: <agent> (context/links)`

## Milestone: MS6 (all three scopes, order C → A → B — see milestones/MS6.md)

## Now (Phase C kickoff + carried-over P1s)

*(no unblocked P1s — remaining P1s in the current Now list require founder
provisioning; heartbeat should pull from Next.)*

## Next (Phase C completion)

- [ ] P2 `route_plans` cache table (Alembic additive migration) keyed on
  `(start, distance, preference)` — owner: staff-engineer
- [ ] P2 Tile provider style URL behind env var (OpenFreeMap default for dev),
  attribution component — owner: staff-engineer (activation blocked
  `[founder]` API key)
- [ ] P2 Error tracking + uptime monitoring (Sentry free tier + health
  pinger), alert path documented — owner: devops-engineer (may need
  `[founder]` Sentry account)
- [ ] P2 Run-tracker regression suite via `?simulate=1` — owner: qa-engineer

## Later (Phase A, then Phase B — expand when phases open)

- [ ] P3 Phase A: Overpass sidewalk estimator; node-degree intersection
  density; scenery signal; `route_feedback` migration + API + UI prompts;
  grade explanation UI; calibration dbt models; scoring v2 docs + tests
  (geometry-dependent items gated on OSRM `foot` cutover)
- [ ] P3 Phase B: public route pages + visibility; OG images; opt-in run
  sharing; PostGIS + `/v1/routes/nearby`; discover page; abuse basics;
  share analytics (gated on tile provider + Phase A explanation UI)

- [ ] P3 Security hardening batch (2026-07-21 audit): FORCE ROW LEVEL SECURITY
  on runs/saved_routes (director-of-data); body-size limit middleware as
  defense-in-depth; UTC-explicit date casts in dim models — owners: various
  (race-safe upsert now done for both runs + saved_routes)
- [ ] P3 Reconcile `docs/routing-setup.md` osrm-partition/customize commands
  with the new runbook (drop the `.osrm` suffix) — owner: technical-writer

## Icebox

## Done

- [x] P2 Production smoke test script + docs — 15 unauthenticated checks
  including an explicit "no localhost in login HTML" guard for the auth
  bug that motivated the task; script ran against production and surfaced
  two real issues (see log) (2026-07-21 run 5, qa-lead; branch
  `heartbeat/2026-07-21-smoke-test`)
- [x] EMERGENCY Fix web auth redirecting to localhost (founder-triggered;
  2026-07-21 mid-session; branch
  `heartbeat/2026-07-21-fix-auth-localhost-fallback`)
- [x] P1 Redis/Upstash rate-limit backend + coverage extension to runs +
  saved-routes writes + XFF-bypass fix + race-safe upserts on both repos
  (2026-07-21 run 4, staff-engineer; branch
  `heartbeat/2026-07-21-c-config-prep`, awaiting founder merge + Upstash
  activation)
- [x] P1 OSRM cutover readiness — no code change needed (env-vars-only
  verified); runbook shipped in `docs/OSRM_CUTOVER_RUNBOOK.md`; foot-profile
  loop tolerance validated on a real local Toronto OSRM (2026-07-21 run 4,
  cto; same branch)
- [x] P1 dbt runs models — source, stg_runs (PII excluded), dim_runs,
  fct_runs_daily + tests (2026-07-21 run 3, director-of-data; branch
  heartbeat/2026-07-21-ms6-kickoff)
- [x] P1 MVP 5 security review — no critical/high open: RLS verified, GPS
  trace capped at 100k positions with tests; findings queued as P2/P3
  (2026-07-21 run 3, security-engineer; same branch)
- [x] P1 CI — GitHub Actions, 3 parallel jobs, all commands dry-run green
  (2026-07-21 run 3, devops-engineer; same branch)

- [x] P1 Fix doc staleness — README to MVP 5 + new `milestones/MS5.md`
  (2026-07-21 run 2, technical-writer; branch
  `heartbeat/2026-07-21-doc-staleness`, awaiting founder merge)
- [x] P1 Draft MVP 6 scope proposal — approved same day: ALL THREE, C → A → B
  (2026-07-21 run 2, head-of-product)
- [x] P1 Groom this backlog against the current milestone (2026-07-21 run 1,
  head-of-product)
