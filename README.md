# RouteGrade

RouteGrade is a quality and safety layer for running routes. It will eventually
score streets and trails using factors such as traffic, lighting, sidewalk
continuity, elevation, scenery, surface, intersections, and reported safety.

**Milestone status:** MVP 5 — live run tracking. MVP 4 took the app public:
two Vercel deployments (`routegrade-web` + `routegrade-api`, see
`docs/deployment.md`), an animated route draw, and per-IP token-bucket rate
limiting on `POST /v1/routes/plan`. MVP 5 adds Nike-Run-Club-style tracking:
pick a route, get a 3-2-1 countdown, then run it with live GPS
time/distance/pace, per-km splits, audio cues, and off-route guidance;
finished runs persist to the new `public.runs` table via `/v1/users/me/runs`
and show up in a history section on `/account`. Everything from MVP 3 (real
route generation from the OSM road graph via OSRM, scoring v1 — see
`docs/scoring.md` — and saved routes) and MVP 2 (Supabase auth, typed FastAPI
user API, Alembic + SQLAlchemy 2, dbt) is preserved — planning and run
tracking are public, saving requires sign-in.

## Architecture

```text
                           +--------------------+
      Google OAuth /       |                    |
      email magic link  -> |   Supabase Auth    |
                           +--------------------+
                                    |
                                    |  session cookies
                                    v
+------------------+        +--------------------+
|  Next.js (App)   | <----> |  Next.js proxy.ts  |
|  /login          |        |  (session refresh) |
|  /auth/callback  |        +--------------------+
|  /account        |                    |
|  /  (public map) |                    |  Bearer access token
+------------------+                    v
                              +----------------------+     geocoding /
                              |    FastAPI API       |     routing / elevation
                              |  /v1/users/me        | --> +------------------+
                              |  /v1/routes/plan     |     | Nominatim, OSRM, |
                              |  /v1/users/me/routes |     | Open-Elevation   |
                              |  /v1/users/me/runs   |     +------------------+
                              |  /health             |
                              +----------------------+
                                    |         ^
                    SQLAlchemy 2    |         | Alembic migrations
                                    v         |
                              +----------------------+
                              |    PostgreSQL        |
                              |    (Supabase-hosted) |
                              |                      |
                              |  auth.users          |  (Supabase-managed)
                              |  public.user_profiles|
                              |  public.saved_routes |
                              |  public.runs         |
                              +----------------------+
                                    ^
                                    | read only
                                    |
                              +----------------------+
                              |         dbt          |
                              |  stg_user_profiles   |
                              |  stg_saved_routes    |
                              |  dim_users, dim_routes
                              |  fct_daily_user_signups
                              |  fct_route_scores_daily
                              +----------------------+
                                    |
                                    v
                                analytics schema
```

### Ownership boundaries

| Component | Owns |
| --- | --- |
| Supabase Auth | Identities, providers, sessions, access / refresh tokens |
| Next.js | Auth UI, callback, session-aware navigation, protected `/account` |
| FastAPI | JWT verification, application validation, route planning + scoring, `user_profiles` / `saved_routes` / `runs` CRUD, per-IP rate limiting |
| SQLAlchemy 2 | Runtime ORM and transactions |
| Alembic | Operational DDL (owns `public.user_profiles`, `public.saved_routes`, `public.runs`) |
| dbt | Read-only sources, staging, marts, tests, analytics documentation |

**Why dbt is not the API transaction layer.** dbt is a batch transformation
tool. Login-time inserts, session-scoped writes, and schema migrations happen
per-request with strict transactional semantics — that's SQLAlchemy + Alembic
territory. dbt reads from the operational tables and produces analytics models
without ever writing back.

## Repository structure

```text
routegrade/
├── agents/                           # company agent role definitions
├── apps/
│   └── web/                          # Next.js 16 (App Router, TS, Tailwind)
│       └── src/
│           ├── app/
│           │   ├── login/            # /login (Google + magic link)
│           │   ├── auth/callback/    # OAuth / OTP callback route
│           │   ├── account/          # protected profile + saved routes + run history
│           │   └── api/health/       # MVP 1 health proxy
│           ├── components/
│           │   ├── auth/             # GoogleSignInButton, EmailMagicLinkForm, SignOutButton
│           │   ├── brand/            # RouteGrade logo
│           │   ├── route-explorer.tsx # planner UI (form, candidates, save, start run)
│           │   ├── route-map.tsx     # MapLibre map, draw animation, runner dot + follow
│           │   ├── run-tracker.tsx   # MVP 5 live run tracker (GPS, splits, audio cues)
│           │   └── session-nav.tsx   # server component pill (Log in / Account)
│           ├── lib/
│           │   ├── supabase/         # browser + server Supabase clients
│           │   ├── api/              # authenticated client + routes/runs API clients
│           │   ├── geo.ts            # haversine, path projection, pace formatting
│           │   └── utils/            # safe-redirect
│           └── proxy.ts              # session-refresh proxy (Next 16 renamed middleware)
├── services/
│   └── api/                          # FastAPI (uv-managed, SQLAlchemy 2)
│       ├── api/index.py              # Vercel serverless entry (vercel.json rewrite)
│       ├── app/
│       │   ├── api/routes/           # users.py, plans.py, saved_routes.py, runs.py
│       │   ├── auth/                 # JWKS + JWT dependency + claims
│       │   ├── core/                 # config.py (pydantic-settings), rate_limit.py
│       │   ├── db/                   # engine, session, models (user_profile, saved_route, run)
│       │   ├── providers/            # geocoding, OSRM routing, elevation
│       │   ├── repositories/         # user_profiles, saved_routes, runs
│       │   ├── schemas/              # request/response models
│       │   └── services/             # provisioning, scoring, route_planner
│       ├── alembic/                  # operational migrations (0001–0003)
│       └── tests/                    # pytest — auth, planning, saved routes, runs, rate limit
├── analytics/
│   └── routegrade_dbt/               # dbt project (dbt-postgres)
├── db/                               # (reserved)
├── docs/
│   ├── supabase-setup.md             # step-by-step provider configuration
│   ├── routing-setup.md              # MVP 3 providers + Phase 0 decisions
│   ├── scoring.md                    # scoring v1 weights and limits
│   ├── deployment.md                 # MVP 4 Vercel deployment, env matrix, caveats
│   └── BACKLOG.md, DECISIONS.md, …   # company ops (heartbeat, approvals, decisions)
├── milestones/                       # MS1.md … MS5.md — what shipped per milestone
└── pipelines/                        # (reserved)
```

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io)
- [uv](https://docs.astral.sh/uv/) (manages its own Python 3.12+)
- A Supabase project (see `docs/supabase-setup.md`)
- A dbt-capable Python 3.10+ venv (only when running analytics — kept isolated
  from the FastAPI environment)

## Environment variables

Every value below has a placeholder in the matching `.env.example` file — never
commit real secrets.

### Frontend (`apps/web/.env.local`)

| Variable | Purpose |
| --- | --- |
| `API_URL` | FastAPI base URL used by the Next.js health proxy (MVP 1) |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MapLibre style URL |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable / anon key (browser-safe) |
| `NEXT_PUBLIC_API_BASE_URL` | FastAPI base URL used by the authenticated client |
| `NEXT_PUBLIC_APP_URL` | Frontend origin used for auth callback redirects |

### FastAPI (`services/api/.env`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLAlchemy Postgres URL (`postgresql+psycopg://…`) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_JWT_ISSUER` | Exact `iss` claim expected on JWTs |
| `SUPABASE_JWKS_URL` | JWKS endpoint for signature verification |
| `SUPABASE_JWT_AUDIENCE` | Expected `aud` claim (default `authenticated`) |
| `SUPABASE_JWT_ALGORITHMS` | Allow-list of algorithms (default `RS256,ES256`) |
| `CORS_ORIGINS` | Comma-separated allow-list |
| `GEOCODER_BASE_URL` / `GEOCODER_USER_AGENT` | Nominatim-compatible geocoder (MVP 3) |
| `OSRM_BASE_URL` / `OSRM_PROFILE` | OSRM routing engine (MVP 3) |
| `ELEVATION_BASE_URL` | Open-Elevation-compatible endpoint (MVP 3) |
| `PROVIDER_TIMEOUT_SECONDS` | Outbound provider call timeout |
| `ROUTE_PLAN_DISTANCE_TOLERANCE` | Accepted ±deviation from requested distance (default 0.10) |
| `ROUTE_PLAN_RATE_LIMIT_PER_MINUTE` | Sustained per-IP requests/minute on `/v1/routes/plan` (default 10, `0` disables) |
| `ROUTE_PLAN_RATE_LIMIT_BURST` | Extra burst headroom above the sustained rate (default 5) |

All provider variables have keyless public defaults good for local development
only — see `docs/routing-setup.md` before any real traffic.

### dbt

See `analytics/routegrade_dbt/profiles.yml.example` for the full list:
`DBT_POSTGRES_HOST`, `DBT_POSTGRES_PORT`, `DBT_POSTGRES_USER`,
`DBT_POSTGRES_PASSWORD`, `DBT_POSTGRES_DATABASE`, `DBT_POSTGRES_SCHEMA`,
`DBT_TARGET`.

## Running locally

### 0. First-time Supabase configuration

Follow `docs/supabase-setup.md`. Populate `apps/web/.env.local` and
`services/api/.env` from the two `.env.example` files.

### 1. Apply the database schema

```bash
cd services/api
uv sync
uv run alembic upgrade head
```

Downgrade with `uv run alembic downgrade -1`.

### 2. Backend — terminal 1

```bash
cd services/api
uv run uvicorn main:app --reload
```

Health: <http://127.0.0.1:8000/health> · Users API prefix: `/v1/users` ·
Route planning: `POST /v1/routes/plan` (public, per-IP rate-limited) ·
Saved routes: `GET/PUT/DELETE /v1/users/me/routes[/:id]` (Bearer) ·
Runs: `GET/PUT/DELETE /v1/users/me/runs[/:id]` (Bearer).

### 3. Frontend — terminal 2

```bash
cd apps/web
pnpm install       # first time only
pnpm dev
```

Open <http://localhost:3000>. `Log in` in the top-right of the route explorer
takes you to `/login`.

### 4. dbt (optional analytics run)

```bash
cd analytics/routegrade_dbt
python -m venv .venv-dbt
source .venv-dbt/bin/activate
pip install "dbt-core>=1.7" "dbt-postgres>=1.7"
# Copy profiles.yml.example -> ~/.dbt/profiles.yml, fill env vars
dbt deps
dbt debug
dbt build
dbt docs generate
```

## Deployment

RouteGrade runs in production as two Vercel projects — `routegrade-web`
(`apps/web`) and `routegrade-api` (`services/api`, FastAPI on the Python
runtime) — plus the Supabase-hosted Postgres. See `docs/deployment.md` for
URLs, the env matrix, deploy commands, and serverless caveats.

## Tests, lint, and build

### Backend

```bash
cd services/api
uv run pytest
uv run ruff check .
```

### Frontend

```bash
cd apps/web
pnpm lint
pnpm build
```

### dbt

```bash
cd analytics/routegrade_dbt
dbt parse       # offline structural check
dbt compile     # requires DB connection
dbt build       # runs models + tests
```

## Authentication verification

Automated tests cover the JWT dependency and the users API end-to-end using a
locally-generated RSA key and a stubbed JWKS endpoint (see
`services/api/tests/conftest.py`). Google OAuth and magic-link email delivery
require a real Supabase project and cannot be exercised without credentials —
follow the checklists in `milestones/MS2.md` §20.2 and §20.3 once your project
is configured.

## Known limitations

- Google OAuth and email magic-link delivery cannot be exercised in this
  environment without a live Supabase project. All code paths are exercised
  via generated tokens in tests; only the last-mile provider round-trip is
  externally-configured.
- `dbt build` requires a reachable PostgreSQL — parse and compile succeed
  offline, but the full run needs a live database.
- `/v1/routes/plan` is rate-limited per IP (MVP 4), but the token bucket lives
  in process memory, so on Vercel the effective limit is per serverless
  instance — see `docs/deployment.md` for the Redis upgrade path. The
  `/v1/users/me/runs` endpoints have no rate limiting yet.
- The default providers are public demo endpoints (the OSRM demo only routes
  the `driving` profile). Self-host OSRM with the `foot` profile before
  promoting beyond a demo audience — see `docs/routing-setup.md`.
- Sidewalk coverage is scored neutrally in v1 (no Overpass integration yet) —
  see `docs/scoring.md`.
- `public.runs` has no analytics coverage yet — dbt staging and marts exist
  only for `user_profiles` and `saved_routes`.

## Tile-provider warning

The default map style (OpenFreeMap) and the MapLibre demo style are fine for
**local development only**. They are not the production tile-provider decision.
Before beta, RouteGrade must adopt a suitable hosted MapLibre-compatible
provider and follow its attribution and usage requirements. Do not configure
public OpenStreetMap tile servers as the production provider.
