# Pending Approvals

Decisions the autonomous heartbeat is NOT allowed to make. Each entry needs a
human (founder) verdict. The heartbeat reads this file every run: entries under
**Approved** get executed and moved to `DECISIONS.md`; entries under **Rejected**
get archived with the reason; entries under **Awaiting decision** are left alone.

Entry format:

```markdown
### <title>
- **Raised**: YYYY-MM-DD by <agent>
- **Type**: new-product | direction-change | architecture | schema-destructive | deploy | spend | org-change | other
- **Proposal**: what is being proposed
- **Recommendation**: what the raising agent recommends and why
- **Options**: alternatives considered
```

## Awaiting decision

*(none — but see "Founder actions needed" below)*

## Founder actions needed

### 1. Apply Alembic migration 0004 to production DB (rate limiter activation)
The Postgres-backed rate limiter is deployed but the `rate_limit_buckets`
table it needs doesn't exist in production yet — migration
`services/api/alembic/versions/20260721_0004_create_rate_limit_buckets.py`
was added on branch `heartbeat/2026-07-21-prod-fixes` (now on main) but no
`alembic upgrade head` has run against prod. Symptom: smoke test check 10
(rate-limit wired) still fails because the limiter is currently failing
open on every DB error.

**Fix — run against production DATABASE_URL:**
```
cd services/api && DATABASE_URL="<prod url>" uv run alembic upgrade head
```

The prod DATABASE_URL is the Supabase project's pooler connection string —
see the Vercel `routegrade-api` project's environment variables. Migration
is additive (only creates a table) and safe to run any time. After it
completes, re-run `bash scripts/smoke-test.sh` — rate-limit check should
flip from FAIL to PASS.

While you're in there, also apply `0003_create_runs` if it hasn't been
applied yet — the runs endpoints are live in prod (smoke test confirms
401), which suggests either the table already exists or it will be needed
the moment a real user tries to save a run.

### 2. OSRM `foot`-profile host
Approved 2026-07-21 (part of MVP 6 phase C). Needs an always-on host for the
Ontario-extract OSRM instance (see `docs/OSRM_CUTOVER_RUNBOOK.md`) — e.g. a
small VPS (Hetzner/DO, ~$5-10/mo) or Fly.io. Once up, set `OSRM_BASE_URL` +
`OSRM_PROFILE=foot` in Vercel env. Cutover is env-vars-only; code side is
already validated on a real local Toronto OSRM.

### 3. Upstash Redis — OPTIONAL, not urgent
Approved 2026-07-21. Postgres backend covers cross-instance rate limiting
already; Upstash is a higher-throughput upgrade only. Skip unless traffic
grows enough that Postgres round-trips per request become measurable
overhead.

### 4. Hosted tile provider
Approved 2026-07-21. Pick MapTiler or Stadia Maps (both have free tiers),
create an API key, set it in Vercel env. Blocks the Phase B public route
pages (public traffic on OpenFreeMap is forbidden per the README).

## Approved

- **2026-07-21 — Supabase Auth URL configuration (Site URL +
  Redirect URLs allowlist)** — completed by founder; Google sign-in
  verified working. Corresponds to run 6c.
- **2026-07-21 — Vercel routegrade-api deploy** — Vercel dashboard fix +
  code-side single-entrypoint refactor landed; API redeployed successfully.
  Smoke test confirms `/v1/users/me/runs` returns 401 (MVP 5 live).
  Corresponds to runs 6b and prior deploy work.
- **2026-07-21 — MVP 6 scope: ALL THREE (A+B+C)**, order C → A → B. In
  `DECISIONS.md`; full option text in git history (`7132c6a`) and
  `milestones/MS6.md`.
- **2026-07-21 — Self-hosted OSRM `foot` profile** — subsumed into MVP 6-C;
  founder action #2 above.
- **2026-07-21 — Redis/Upstash rate limiting** — subsumed into MVP 6-C;
  founder action #3 above (now optional after Postgres backend shipped).
- **2026-07-21 — Hosted tile provider** — subsumed into MVP 6-C; founder
  action #4 above.

## Rejected

*(none)*
