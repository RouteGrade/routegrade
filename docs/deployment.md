# Deployment — Vercel

> Also mirrored in Notion: [Deployment](https://app.notion.com/p/3a5dc99a22218123bf51c176dc16e764). This file is the source of truth; re-sync the Notion copy when this changes materially.

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

## Rate limiting backends

Every rate limiter (`/plan`, `/v1/users/me/runs` writes, `/v1/users/me/routes`
writes) goes through the same `RateLimiter` protocol in
`app/core/rate_limit.py`. Three backends ship, all interchangeable. The API
picks one at startup based on environment variables — **no founder action is
required to get cross-instance rate limiting**, because a production deploy
already has `DATABASE_URL` set.

| Backend | When active | Cross-instance? | Extra setup |
| --- | --- | --- | --- |
| **In-memory** | Local dev, tests | No | Default when `RATE_LIMIT_USE_POSTGRES=false` and Upstash creds are unset |
| **Postgres** (prod default) | Production | Yes | None — reuses `DATABASE_URL` |
| **Redis / Upstash** | High-throughput opt-in | Yes | Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` |

Selection priority: Upstash creds > Postgres (`RATE_LIMIT_USE_POSTGRES=true`
+ `DATABASE_URL`) > in-memory. To force the in-memory backend for local
development, set `RATE_LIMIT_USE_POSTGRES=false`.

The Postgres backend stores bucket state in `public.rate_limit_buckets`
(migration `0004_create_rate_limit_buckets`). Each `check()` is a single
atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so two concurrent
requests on the same key cannot both spend the last token: the UPSERT takes
a `ROW EXCLUSIVE` lock on the conflicting row and the second call blocks
until the first commits. All infrastructure failures (statement timeout,
connection loss) log a warning and **fail open** — rate limiting must never
take the site offline.

The Redis backend uses an atomic Lua-scripted token bucket over Upstash's
HTTPS REST API, so every instance shares the same buckets and the limit is
truly global. It also fails **open** on any Redis error (timeout, non-2xx,
malformed response) — an Upstash outage never blocks legitimate writes.

### Activating Upstash

1. Provision an Upstash Redis database (free tier is fine to start).
2. In each Vercel project's Production env, set:

   | Variable | Value |
   | --- | --- |
   | `UPSTASH_REDIS_REST_URL` | Upstash → REST → **UPSTASH_REDIS_REST_URL** |
   | `UPSTASH_REDIS_REST_TOKEN` | Upstash → REST → **UPSTASH_REDIS_REST_TOKEN** |

3. Redeploy the API. That is the whole activation — no code change and no
   other flag toggle. Both blank ⇒ falls through to Postgres (or in-memory);
   both set ⇒ Upstash.

### Tunable per-endpoint limits

All defaults are permissive enough for a real UI flow but strict enough that a
runaway script hits a wall well before it can DoS the DB. Override any of
these in Vercel env if the traffic pattern changes:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ROUTE_PLAN_RATE_LIMIT_PER_MINUTE` | 10 | Per-IP `/v1/routes/plan` sustained rate |
| `ROUTE_PLAN_RATE_LIMIT_BURST` | 5 | Extra burst headroom |
| `RUNS_RATE_LIMIT_PER_MINUTE` | 60 | Per-user `PUT /v1/users/me/runs/{id}` sustained rate |
| `RUNS_RATE_LIMIT_BURST` | 60 | Extra burst headroom |
| `SAVED_ROUTES_RATE_LIMIT_PER_MINUTE` | 30 | Per-user `PUT /v1/users/me/routes/{id}` sustained rate |
| `SAVED_ROUTES_RATE_LIMIT_BURST` | 30 | Extra burst headroom |

Capacity = `PER_MINUTE + BURST`. Setting `PER_MINUTE=0` disables that limiter.

## Known serverless caveats

1. **Client-IP trust.** The `/plan` limiter reads `x-real-ip` first
   (Vercel-supplied, trusted), then falls back to the *rightmost*
   `x-forwarded-for` hop. Never use the leftmost hop — clients can spoof it.
2. **Cold starts** add ~1-2 s to the first request on an idle function.
3. **Provider defaults are still the public demo endpoints** (Nominatim public
   instance, OSRM demo with the driving profile). Self-host OSRM (`foot`) and
   point `OSRM_BASE_URL` at it before promoting beyond a demo audience — see
   `docs/routing-setup.md`.
4. The database connection uses a fresh pool per instance; keep using the
   Supabase pooled connection string. Rate-limit checks reuse the same pool
   in short-lived AUTOCOMMIT transactions so they cannot be rolled back by a
   caller's outer transaction.
