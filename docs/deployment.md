# Deployment — Vercel

RouteGrade ships as two Vercel projects plus the existing Supabase-hosted
Postgres. First deployed 2026-07-17 (MVP 4).

| Project | Source dir | Production URL |
| --- | --- | --- |
| `routegrade-web` | `apps/web` | <https://routegrade-web.vercel.app> |
| `routegrade-api` | `services/api` | <https://routegrade-api.vercel.app> |

## How the API runs on Vercel

- `api/index.py` re-exports the FastAPI `app`; `vercel.json` rewrites every
  path to it, so FastAPI keeps doing its own routing.
- `requirements.txt` is **generated** from uv — after changing dependencies run:
  `uv export --no-dev --format requirements-txt --no-hashes -o requirements.txt`
- `.vercelignore` keeps `.venv`, tests, and `.env` out of the upload.
- `maxDuration` is 60 s — `/v1/routes/plan` fans out to three providers and can
  take 10-20 s.

## Deploying

```bash
# API
cd services/api && npx vercel deploy --prod --yes
# Web
cd apps/web && npx vercel deploy --prod --yes
```

Environment variables live in each Vercel project (Production env). The API
needs everything from `services/api/.env.example`; the web app needs the
`NEXT_PUBLIC_*` set plus `API_URL`. `CORS_ORIGINS` on the API must include the
web production URL. Changing an env var requires a redeploy to take effect.

## Manual one-time setup still required

- **Supabase Auth redirect allow-list**: add
  `https://routegrade-web.vercel.app/auth/callback` (and the site URL) in
  Supabase → Authentication → URL Configuration, or Google / magic-link
  sign-in will bounce back to localhost in production.

## Known serverless caveats

1. **Rate limiting is per-instance.** The `/plan` token bucket lives in process
   memory; Vercel may run several instances, so the effective global limit is
   `limit × instances` and resets on cold starts. Acceptable for MVP 4 —
   swap the storage for Redis/Upstash behind the same `check()` interface when
   it matters.
2. **Cold starts** add ~1-2 s to the first request on an idle function.
3. **Provider defaults are still the public demo endpoints** (Nominatim public
   instance, OSRM demo with the driving profile). Self-host OSRM (`foot`) and
   point `OSRM_BASE_URL` at it before promoting beyond a demo audience — see
   `docs/routing-setup.md`.
4. The database connection uses a fresh pool per instance; keep using the
   Supabase pooled connection string.
