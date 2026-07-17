# RouteGrade MVP 4 — Deployment & Route Animation

Scope was re-set by the product owner after the original MVP 4 draft (see the
Notion doc): **ship the app publicly (Vercel) and animate route drawing**,
with the minimum hardening that a public deployment demands. The larger draft
scope (scoring v2, sharing, PostGIS, feedback loop) moves to the backlog.

## What shipped (2026-07-17)

### Deployment
- Two Vercel projects: `routegrade-web` (Next.js, `apps/web`) and
  `routegrade-api` (FastAPI via the Python runtime, `services/api`), both
  live — see `docs/deployment.md` for URLs, env matrix, and caveats.
- API serverless entry (`api/index.py` + `vercel.json` rewrite), generated
  `requirements.txt`, `.vercelignore`.
- Verified in production: health, live route planning, CORS from the web
  origin, and the web → API health proxy.

### Route draw animation (`apps/web/src/components/route-map.tsx`)
- Every displayed route (new candidates, candidate switches, reopened saved
  routes) animates from its starting point toward the end: camera fits bounds
  (~0.9 s), then the LineString grows over ~1.6 s with cubic easing and an
  interpolated tip.
- Usability preserved: the animation only mutates GeoJSON source data via
  `requestAnimationFrame`, so pan/zoom/controls stay responsive throughout;
  switching candidates cancels the in-flight animation cleanly; and
  `prefers-reduced-motion` skips straight to the full route.

### Hardening required by going public
- Per-IP token-bucket rate limit on `POST /v1/routes/plan` (default 10/min
  sustained + 5 burst, env-tunable, 0 disables): 429 with `Retry-After`,
  proxy-aware client IP (`X-Forwarded-For`), dependency-free implementation
  (`app/core/rate_limit.py`). Frontend shows a friendly cooldown message.
- Known limit: the bucket is per serverless instance — documented in
  `docs/deployment.md` with the Redis upgrade path.

## Verification
- 67 API tests green (4 new rate-limit tests), ruff clean.
- `tsc`, `eslint`, `next build` clean.
- Production smoke: `GET /health` 200, live plan for downtown Toronto returns
  scored candidates, CORS preflight allows the web origin.

## Manual follow-ups
- Add `https://routegrade-web.vercel.app/auth/callback` to the Supabase Auth
  redirect allow-list (production sign-in depends on it).
- Self-host OSRM with the `foot` profile before promoting beyond a demo
  audience.
