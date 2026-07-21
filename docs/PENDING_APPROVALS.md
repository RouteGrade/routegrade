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

### 1b. Fix Vercel deploy for routegrade-api (URGENT — API stuck at MVP 4)
The build failure is now known: Vercel introduced a **FastAPI framework
preset** that auto-detects FastAPI apps. Actual build log:
```
Error: No FastAPI entrypoint found in default locations, but found
potential entrypoints:
  services/api/api/index.py (variable: app)
  services/api/app/main.py (variable: app)
  services/api/main.py (variable: app)
```
Two conditions caused the failure together:
1. Vercel's Root Directory is at the repo root, not `services/api`, so the
   preset can't find a `main.py` in a "default location" (the project root).
2. Three files exported `app`, so even if Root Directory were fixed, the
   preset had no unambiguous entrypoint to pick.

Code fix (branch `heartbeat/2026-07-21-vercel-fastapi-fix`, commit
`473fe6d`, pushed): removed `services/api/api/index.py` (redundant Vercel
serverless stub) and simplified `services/api/vercel.json` to
`{"framework": "fastapi"}`. Now only `services/api/main.py` and
`services/api/app/main.py` remain — with Root Directory set correctly, the
preset finds `main.py` at project root unambiguously.

**Founder actions to complete the fix**:
1. Merge `heartbeat/2026-07-21-vercel-fastapi-fix` into main.
2. In Vercel dashboard → `routegrade-api` project → Settings → General:
   verify **Root Directory** is `services/api`. If it isn't, set it.
3. Settings → Git: verify repo connection to `RouteGrade/routegrade`,
   Production Branch = `main`. Clear any Ignored Build Step that might
   return exit 0.
4. Deployments → Redeploy on latest main (uncheck "Use existing Build
   Cache" for a clean build).
5. Re-run `scripts/smoke-test.sh` — the /v1/users/me/runs check should
   flip from 404 to 401 (endpoint exists, needs auth).

**Exact click path**:
1. https://vercel.com/dashboard → RouteGrade team → project **`routegrade-api`**
   (id `prj_YlDO1pBAQ3Crb3CZdgfnUAXiXfmn`, NOT `routegrade-web`)
2. **Settings → Git**: verify repo connection to `RouteGrade/routegrade` and
   that Production Branch = `main`. Reconnect if it shows disconnected.
3. Under **Ignored Build Step**: confirm it is empty OR set to a command
   returning exit code `1` (build). If a custom script returns `0`, that's
   almost certainly the bug — clear it.
4. Under **Root Directory**: confirm `services/api`.
5. **Deployments** tab: click **Redeploy** on the latest main commit with
   "Use existing Build Cache" **unchecked** to force a clean build.
6. If step 5 fails at build time, capture the log and we can fix it code-side.
   Fallback CLI: `cd services/api && vercel --prod` (project link already in
   `.vercel/project.json`).

After the deploy succeeds, merge the queued branches (recommended order:
`prod-fixes` last — it already includes `c-config-prep`, so `c-config-prep`
can be dropped or merged first and the merge into main will fast-forward).
Then re-run `scripts/smoke-test.sh` — checks should go 15/15.

### 2. OSRM `foot`-profile host
Approved 2026-07-21 (part of MVP 6 phase C). Needs an always-on host for the
Ontario-extract OSRM instance (`docs/routing-setup.md` has the build steps) —
e.g. a small VPS (Hetzner/DO, ~$5-10/mo) or Fly.io. Once up, set
`OSRM_BASE_URL` + `OSRM_PROFILE=foot` in Vercel env. The heartbeat will have
config/code ready so cutover is env-vars-only.

### 3. Upstash Redis (rate limiting) — NO LONGER URGENT
Approved 2026-07-21. **Update 2026-07-21 run 6**: heartbeat added a
Postgres-backed rate-limiter backend on branch
`heartbeat/2026-07-21-prod-fixes` that uses the existing Supabase database
via `DATABASE_URL` (already set in Vercel). Priority is Redis > Postgres >
in-memory — so when the branch is merged and the API redeploys, cross-
instance rate limiting works automatically with zero founder action, no
new paid vendor. Upstash is now an **optional** higher-throughput upgrade,
not a blocker. Leave this queued if you want to opt in later.

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
