# Heartbeat Log

One entry per autonomous run, newest first. Written by the company-heartbeat
skill at the end of every run.

Entry format:

```markdown
## YYYY-MM-DD HH:MM
- **Did**: what was completed this run (with branch/commit refs)
- **Verified**: build/test/review status
- **Queued**: new approvals raised or backlog items added
- **Blocked**: anything waiting on the founder
```

## 2026-07-21 16:01 (run 5, cron)
- **Did**: qa-lead built a production smoke test at `scripts/smoke-test.sh`
  with 15 unauthenticated checks (curl + jq only, no secrets). Notably
  includes an explicit "no localhost URLs in the /login HTML" guard —
  exactly the failure mode the founder hit earlier in the session. Docs at
  `docs/SMOKE_TEST.md`. On branch
  `heartbeat/2026-07-21-smoke-test` (commit `546ec1c`, pushed, NOT merged).
  This run also caught up the backlog Done section with the earlier
  founder-triggered auth-localhost fix branch, which was missing.
- **Verified**: qa-lead ran the smoke test against actual production
  (`routegrade-web.vercel.app` + `routegrade-api.vercel.app`) —
  **13 passed, 2 failed** — full output preserved in the review that
  authorized this commit. The auth-callback-URL guard PASSED against prod
  (production is fine now).
- **Two real production issues surfaced by the smoke test (queued):**
  1. **`/v1/users/me/runs` returns 404 on production** — the deployed API
     is pre-MVP-5. The MVP 5 run-tracking router exists in the repo but was
     never actually deployed. Live run tracking has been shipping a UI
     against an endpoint that isn't there. Filed as PENDING_APPROVALS #1b
     (URGENT — founder needs to trigger a Vercel API deploy).
  2. **Rate limiter never returned 429** on a 25-burst against
     `/v1/routes/plan` — the documented "per-instance" limiter is spread
     across Vercel serverless instances, so a single-client burst against
     a scaled fleet effectively never trips. Not a new bug — this is
     exactly what the Upstash approval item exists to fix
     (`PENDING_APPROVALS.md` #3, code side already shipped on
     `heartbeat/2026-07-21-c-config-prep`).
- **Queued**: nothing new beyond the two production findings above.
- **Blocked on founder** (five branches now queued for merge, plus deploy):
  - `heartbeat/2026-07-21-doc-staleness` — README truth-up + MS5
  - `heartbeat/2026-07-21-ms6-kickoff` — dbt runs models + CI + security cap
  - `heartbeat/2026-07-21-c-config-prep` — Redis backend + OSRM runbook
  - `heartbeat/2026-07-21-fix-auth-localhost-fallback` — auth localhost fix
  - `heartbeat/2026-07-21-smoke-test` — this run's smoke test
  - **Then trigger a Vercel API deploy** to bring MVP 5 endpoints live.
  - Supabase redirect allow-list (still open), Upstash creds, OSRM host,
    tile provider key — all still queued in PENDING_APPROVALS.md.

## 2026-07-21 14:05 (run 4, founder-triggered)
- **Did**: Two more Phase C P1s in parallel on branch
  `heartbeat/2026-07-21-c-config-prep` (commit `3a78c79`, pushed, NOT merged).
  (1) staff-engineer: Redis/Upstash rate-limit backend behind the existing
  `check()` interface with atomic Lua EVAL, comprehensive fail-open behavior,
  `get_limiter()` factory activated only when both Upstash env vars are set;
  extended per-user rate limiting to `PUT /v1/users/me/runs` and
  `PUT /v1/users/me/routes`; fixed the leftmost-XFF spoof bypass in the
  /plan endpoint (now x-real-ip → rightmost XFF → client.host); race-safe
  insert in the runs repository (IntegrityError → 409). (2) cto: OSRM
  cutover verified env-vars-only (no code changes required); shipped
  `docs/OSRM_CUTOVER_RUNBOOK.md`; spun up a real local OSRM foot instance
  against a Toronto extract and confirmed loop tolerance converges to
  ±2.3% across 2-10km loops (well inside the ±10% target). Staff-engineer
  APPROVE with one should-fix: saved_routes had the same race the runs fix
  addressed — applied the mirror fix.
- **Verified**: services/api tests 107 passed (was 82, +25 net), ruff clean.
  Redis fail-open covered by 16 dedicated tests hitting timeout, HTTP errors,
  bad JSON, Upstash `{"error":...}` envelopes, and malformed result shapes.
  OSRM verification: real local instance built from a 101MB Toronto extract,
  planner sweep passed, existing plan tests pass with env pointed at it.
- **Queued**: (P3) technical-writer to reconcile `docs/routing-setup.md`
  osrm-partition/customize commands with the newer runbook form.
- **Blocked on founder**:
  - **Merge branches** (still no `gh`): `doc-staleness`, `ms6-kickoff`,
    `c-config-prep`. Three branches queued for merge.
  - **Supabase redirect allow-list** (still urgent, production sign-in broken).
  - **Upstash Redis creds** — code-side complete; setting
    `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in Vercel activates
    the shared backend.
  - **OSRM foot host** — code-side complete; runbook is in
    `docs/OSRM_CUTOVER_RUNBOOK.md`; setting `OSRM_BASE_URL` +
    `OSRM_PROFILE=foot` in Vercel activates the cutover.
  - **Tile provider key** — next run picks up.
- **Ops note**: workspace SSH known_hosts was missing github.com on this
  run; added on-the-fly to unblock the push. Not a company issue — a
  workspace environment quirk.

## 2026-07-21 03:05 (run 3, founder-triggered — MVP 6 approved)
- **Did**: Founder approved MVP 6 = ALL THREE scopes (A+B+C), order C → A → B;
  recorded in DECISIONS.md, MS6.md written, backlog re-planned into phases,
  approvals file converted to a "founder actions needed" list. Then executed
  three P1s in parallel on branch `heartbeat/2026-07-21-ms6-kickoff`
  (commit `13589c3`, pushed, NOT merged): (1) director-of-data shipped dbt
  runs models (source + stg_runs excluding GPS trace, dim_runs,
  fct_runs_daily, schema + singular tests); (2) security-engineer audited the
  MVP 5 surface — RLS/authz/injection/mass-assignment verified safe, one HIGH
  fixed (GPS trace position cap, now 100k after review sizing) — remaining
  findings queued P2/P3; (3) devops-engineer added GitHub Actions CI (api,
  web, analytics jobs). Staff-engineer reviewed the combined diff: APPROVE
  with 4 should-fixes, all applied (cap resized w/ distance-gated rationale,
  CI push filter to main, contents:read, dbt version floor 1.10).
- **Verified**: 82 API tests pass post-fixes, ruff clean, web lint+build
  clean, dbt parse clean, CI YAML validated (workflow itself can't run until
  the branch is merged).
- **Queued**: P2 XFF rate-limit-key fix, P3 security hardening batch.
- **Blocked on founder**: merge branches `heartbeat/2026-07-21-doc-staleness`
  and `heartbeat/2026-07-21-ms6-kickoff` (no `gh` CLI, so no PRs — merge via
  GitHub UI or ask me); 4 founder actions in PENDING_APPROVALS.md — Supabase
  allow-list (urgent), OSRM host, Upstash creds, tile provider key.

## 2026-07-21 03:00 (run 2, founder-triggered)
- **Did**: Two P1s in parallel. (1) technical-writer fixed doc staleness:
  README truth-up MVP 3 → MVP 5 (status, architecture diagram, ownership
  table, repo tree, env vars, known limitations) and new `milestones/MS5.md`
  — on branch `heartbeat/2026-07-21-doc-staleness` (commit `3fe9ce8`), pushed,
  NOT merged. `gh` CLI unavailable, so no PR was opened — founder should open/
  merge the branch manually. (2) head-of-product delivered the full MVP 6
  scope proposal — the placeholder entry in `PENDING_APPROVALS.md` is replaced
  by three detailed options (A: scoring v2 + feedback loop, B: social/sharing,
  C: production hardening) with effort, risks, and dependencies.
  Recommendation: Option A, gated on approving the OSRM `foot` profile first.
- **Verified**: services/api `uv run pytest` 80 passed, `ruff check` clean;
  apps/web `pnpm lint` + `pnpm build` clean (run by technical-writer against
  the branch). Diff reviewed by orchestrator; docs-only, no code paths touched.
- **Queued**: nothing new; MVP 6 entry upgraded from placeholder to decidable.
- **Blocked**: branch merge + all 6 approval verdicts await the founder. Most
  urgent remain: Supabase redirect allow-list (production sign-in broken) and
  OSRM foot profile (gates the recommended MVP 6).

## 2026-07-21 02:27
- **Did**: First heartbeat run. Head-of-product groomed the backlog against
  actual repo state: reconciled milestone status (code is at MVP 5, docs said
  MVP 3), produced 10 concrete items (4×P1, 4×P2, 2×P3) across
  technical-writer, director-of-data, security-engineer, head-of-product,
  staff-engineer, devops-engineer, qa-engineer, qa-lead. No code changes this
  run — grooming only, per the seeded backlog.
- **Verified**: n/a (docs-only run; no build/tests touched).
- **Queued**: 5 entries in PENDING_APPROVALS.md — most urgent: production
  grades running routes with the OSRM demo's DRIVING profile (self-host foot
  profile recommended), and production sign-in is broken until the founder
  adds the Vercel callback URL to the Supabase redirect allow-list.
- **Blocked**: MVP 6 direction (proposal being drafted as P1); all 5 approval
  entries await founder verdicts.
