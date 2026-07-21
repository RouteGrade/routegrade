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

These are approved but physically require the founder's accounts/dashboards.
The heartbeat implements everything code-side behind env vars in the meantime.

### 1. Supabase auth redirect allow-list (URGENT — production sign-in broken)
Add `https://routegrade-web.vercel.app/auth/callback` to the Supabase Auth
redirect allow-list. 2-minute dashboard action, no code involved. Also merge
branch `heartbeat/2026-07-21-fix-auth-localhost-fallback` — it hardens the
web to fall back to `window.location.origin` instead of localhost when
`NEXT_PUBLIC_APP_URL` is unset. Belt-and-suspenders: set that env var in
Vercel too (`NEXT_PUBLIC_APP_URL=https://routegrade-web.vercel.app`).

### 1b. Deploy MVP 5 to production API (URGENT — runs API is not live)
Smoke test discovered `GET /v1/users/me/runs` returns **404** on
`routegrade-api.vercel.app` because the deployed API is pre-MVP-5. The runs
router exists in the repo (`services/api/app/api/routes/runs.py`, wired in
`app/main.py`) but has never been deployed. This means live run tracking
appears to work in the UI but silently fails to save runs (or falls back to
a stale endpoint). Founder action: trigger a fresh Vercel deploy of
`routegrade-api` from `main` (or better, merge the queued heartbeat branches
first, then deploy). After deploy, re-run `scripts/smoke-test.sh` — check 14
should flip from 404 to 401.

### 2. OSRM `foot`-profile host
Approved 2026-07-21 (part of MVP 6 phase C). Needs an always-on host for the
Ontario-extract OSRM instance (`docs/routing-setup.md` has the build steps) —
e.g. a small VPS (Hetzner/DO, ~$5-10/mo) or Fly.io. Once up, set
`OSRM_BASE_URL` + `OSRM_PROFILE=foot` in Vercel env. The heartbeat will have
config/code ready so cutover is env-vars-only.

### 3. Upstash Redis (rate limiting)
Approved 2026-07-21. Create a free-tier Upstash Redis database and set its
REST URL/token in Vercel env. Heartbeat implements the Redis backend behind
the existing `check()` interface with in-memory fallback.

### 4. Hosted tile provider
Approved 2026-07-21. Pick MapTiler or Stadia Maps (both have free tiers),
create an API key, set it in Vercel env. Heartbeat wires the style URL behind
an env var with the current OpenFreeMap default for local dev.

## Approved

- **2026-07-21 — MVP 6 scope: ALL THREE (A+B+C)**, order C → A → B. Moved to
  `DECISIONS.md`; full option text in git history (`7132c6a`) and
  `milestones/MS6.md`.
- **2026-07-21 — Self-hosted OSRM `foot` profile** — subsumed into MVP 6-C;
  founder action #2 above.
- **2026-07-21 — Redis/Upstash rate limiting** — subsumed into MVP 6-C;
  founder action #3 above.
- **2026-07-21 — Hosted tile provider** — subsumed into MVP 6-C; founder
  action #4 above.

## Rejected

*(none)*
