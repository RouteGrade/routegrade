# Company Backlog

Prioritized work queue for the autonomous heartbeat. The heartbeat works items
top-to-bottom. Items marked `[founder]` need founder-side accounts/dashboards.

Format: `- [ ] P<1-3> <item> — owner: <agent> (context/links)`

## Milestone: MS6 (all three scopes, order C → A → B — see milestones/MS6.md)

## Production status (as of 2026-07-21 run 6c)

**Live and healthy** — 14/15 smoke checks pass. Google sign-in works. MVP 5
runs endpoints are live (`/v1/users/me/runs` returns 401 unauth). Web +
API deployments both current.

**One outstanding prod issue**: rate limiter never trips (Postgres migration
0004 not yet applied to prod DB — see `PENDING_APPROVALS.md` #1).

## Now (Phase C completion — mostly P2)

- [ ] P2 Tile provider style URL behind env var (OpenFreeMap default for dev),
  attribution component — owner: staff-engineer (activation blocked
  `[founder]` API key; Phase B blocker)
- [ ] P2 `route_plans` cache table (Alembic additive migration) keyed on
  `(start, distance, preference)` — owner: staff-engineer
- [ ] P2 Error tracking + uptime monitoring (Sentry free tier + health
  pinger), alert path documented — owner: devops-engineer (may need
  `[founder]` Sentry account)
- [ ] P2 Run-tracker regression suite via `?simulate=1` — owner: qa-engineer

## Next (Phase A opens once foot-profile OSRM is live)

- [ ] P2 Phase A: feedback capture — `route_feedback` migration + POST
  `/v1/routes/{id}/feedback` + client prompts after viewing a route and
  after finishing a run (no dependency on OSRM cutover — can start now)
- [ ] P2 Phase A: grade explanation UI on the route card (per-factor
  sub-scores + one-line reasons) — owner: staff-engineer (no OSRM
  dependency)

## Later (Phase A geometry work + Phase B)

- [ ] P3 Phase A (foot-profile gated): Overpass sidewalk estimator;
  node-degree intersection density; scenery signal; calibration dbt models;
  scoring v2 docs + tests
- [ ] P3 Phase B (gated on tile provider + Phase A explanation UI): public
  route pages + visibility; OG images; opt-in run sharing; PostGIS +
  `/v1/routes/nearby`; discover page; abuse basics; share analytics

- [ ] P3 Security hardening batch (2026-07-21 audit): FORCE ROW LEVEL SECURITY
  on runs/saved_routes (director-of-data); body-size limit middleware as
  defense-in-depth; UTC-explicit date casts in dim models — owners: various
- [ ] P3 Reconcile `docs/routing-setup.md` osrm-partition/customize commands
  with the new runbook (drop the `.osrm` suffix) — owner: technical-writer
- [ ] P3 Merge the `heartbeat/2026-07-21-single-entrypoint` branch — no
  longer critical but reduces future Vercel confusion (only one
  module-level `app` export left in the repo)

## Icebox

## Done

- [x] CRITICAL Diagnose "sign-in still redirects to localhost" — verified
  code fix landed in prod HTML (no localhost URLs in client bundle);
  identified Supabase Site URL fallback as the actual load-bearing setting;
  founder applied dashboard fix and Google sign-in now works (2026-07-21
  run 6c)
- [x] URGENT Reduce entrypoint ambiguity — moved `app = create_app()`
  singleton out of `app/main.py` so `services/api/main.py` is the sole
  module-level `app` export in the repo (2026-07-21 run 6b, branch
  `heartbeat/2026-07-21-single-entrypoint`, not yet merged — production
  is fine without it, so it's optional cleanup now)
- [x] URGENT Vercel FastAPI-preset build fix — deleted redundant
  `api/index.py`, simplified `vercel.json` to declare FastAPI framework
  preset. Founder merged + fixed Vercel Root Directory → routegrade-api
  deploy went green (2026-07-21 run 6b, branch
  `heartbeat/2026-07-21-vercel-fastapi-fix`, merged as `db16e03`)
- [x] URGENT Postgres-backed rate-limiter — eliminates the Upstash
  dependency; factory priority Redis > Postgres > in-memory. Ships bundled
  with c-config-prep on branch `heartbeat/2026-07-21-prod-fixes`
  (2026-07-21 run 6, staff-engineer, merged as `249fd1d`).
  **NOTE**: table migration 0004 still needs to run against prod DB — see
  PENDING_APPROVALS #1.
- [x] URGENT Diagnose stale prod API deploy — root cause was Vercel dashboard
  auto-deploy misconfigured + FastAPI framework-preset ambiguity; full
  diagnosis in PENDING_APPROVALS history (2026-07-21 run 6, devops-engineer)
- [x] P2 Production smoke test script + docs — 15 checks including the
  "no localhost in login HTML" guard that has already earned its keep
  (2026-07-21 run 5, qa-lead, merged as `b2cf890`)
- [x] EMERGENCY Fix web auth redirecting to localhost — code-side fallback
  to `window.location.origin` when `NEXT_PUBLIC_APP_URL` is unset
  (2026-07-21 mid-session, merged as `f095186`)
- [x] P1 Redis/Upstash rate-limit backend + coverage extension to runs +
  saved-routes writes + XFF-bypass fix + race-safe upserts on both repos
  (2026-07-21 run 4, staff-engineer, subsumed into prod-fixes)
- [x] P1 OSRM cutover readiness — no code change needed (env-vars-only
  verified); runbook shipped in `docs/OSRM_CUTOVER_RUNBOOK.md`; foot-profile
  loop tolerance validated on a real local Toronto OSRM (2026-07-21 run 4,
  cto)
- [x] P1 dbt runs models — source, stg_runs (PII excluded), dim_runs,
  fct_runs_daily + tests (2026-07-21 run 3, director-of-data)
- [x] P1 MVP 5 security review — no critical/high open: RLS verified, GPS
  trace capped at 100k positions with tests; findings queued as P2/P3
  (2026-07-21 run 3, security-engineer)
- [x] P1 CI — GitHub Actions, 3 parallel jobs, all commands dry-run green
  (2026-07-21 run 3, devops-engineer)
- [x] P1 Fix doc staleness — README to MVP 5 + new `milestones/MS5.md`
  (2026-07-21 run 2, technical-writer)
- [x] P1 Draft MVP 6 scope proposal — approved same day: ALL THREE, C → A → B
  (2026-07-21 run 2, head-of-product)
- [x] P1 Groom this backlog against the current milestone (2026-07-21 run 1,
  head-of-product)
