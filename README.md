# RouteGrade

RouteGrade is a quality and safety layer for running routes. It will eventually
score streets and trails using factors such as traffic, lighting, sidewalk
continuity, elevation, scenery, surface, intersections, and reported safety.

**Milestone status:** MVP 2 — authentication (Supabase), typed FastAPI user API,
operational schema managed with Alembic + SQLAlchemy 2, and a dbt analytics
project. The MVP 1 walking skeleton (map + route form + health proxy) is
preserved and remains publicly accessible without login.

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
                              +----------------------+
                              |    FastAPI API       |
                              |  /v1/users/me PUT    |
                              |  /v1/users/me GET    |
                              |  /v1/users/me PATCH  |
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
                              +----------------------+
                                    ^
                                    | read only
                                    |
                              +----------------------+
                              |         dbt          |
                              |  stg_user_profiles   |
                              |  dim_users           |
                              |  fct_daily_user_signups
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
| FastAPI | JWT verification, application validation, `user_profiles` CRUD |
| SQLAlchemy 2 | Runtime ORM and transactions |
| Alembic | Operational DDL (owns `public.user_profiles`) |
| dbt | Read-only sources, staging, marts, tests, analytics documentation |

**Why dbt is not the API transaction layer.** dbt is a batch transformation
tool. Login-time inserts, session-scoped writes, and schema migrations happen
per-request with strict transactional semantics — that's SQLAlchemy + Alembic
territory. dbt reads from the operational tables and produces analytics models
without ever writing back.

## Repository structure

```text
routegrade/
├── apps/
│   └── web/                         # Next.js 16 (App Router, TS, Tailwind)
│       └── src/
│           ├── app/
│           │   ├── login/            # /login (Google + magic link)
│           │   ├── auth/callback/    # OAuth / OTP callback route
│           │   ├── account/          # protected user profile
│           │   └── api/health/       # MVP 1 health proxy
│           ├── components/
│           │   ├── auth/             # GoogleSignInButton, EmailMagicLinkForm, SignOutButton
│           │   └── session-nav.tsx   # server component pill (Log in / Account)
│           ├── lib/
│           │   ├── supabase/         # browser + server Supabase clients
│           │   ├── api/              # authenticated FastAPI client
│           │   └── utils/            # safe-redirect
│           └── proxy.ts              # session-refresh proxy (Next 16 renamed middleware)
├── services/
│   └── api/                          # FastAPI (uv-managed, SQLAlchemy 2)
│       ├── app/
│       │   ├── api/routes/users.py   # /v1/users/me
│       │   ├── auth/                 # JWKS + JWT dependency + claims
│       │   ├── core/config.py        # typed pydantic-settings
│       │   ├── db/                   # engine, session, models
│       │   ├── repositories/         # user_profiles
│       │   ├── schemas/              # request/response models
│       │   └── services/             # provisioning
│       ├── alembic/                  # operational migrations
│       └── tests/                    # pytest — auth + endpoint coverage
├── analytics/
│   └── routegrade_dbt/               # dbt project (dbt-postgres)
├── db/                               # (reserved)
├── docs/
│   └── supabase-setup.md             # step-by-step provider configuration
├── milestones/
│   ├── MS1.md
│   └── MS2.md
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

Health: <http://127.0.0.1:8000/health> · Users API prefix: `/v1/users`.

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

## Tile-provider warning

The default map style (OpenFreeMap) and the MapLibre demo style are fine for
**local development only**. They are not the production tile-provider decision.
Before beta, RouteGrade must adopt a suitable hosted MapLibre-compatible
provider and follow its attribution and usage requirements. Do not configure
public OpenStreetMap tile servers as the production provider.
