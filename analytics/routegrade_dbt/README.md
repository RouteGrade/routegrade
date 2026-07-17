# RouteGrade dbt project

Analytics transformations that read RouteGrade's operational schema
(`public.user_profiles`) and build models in the `analytics` schema.

## Boundary

dbt is **read-only** against the operational database. Login-time writes,
Alembic-owned DDL, and FastAPI transactions are out of scope for dbt.

## Requirements

- Python 3.10+
- `dbt-core >= 1.7`, `dbt-postgres >= 1.7`
- Access to the RouteGrade PostgreSQL database with a role that can:
  - `SELECT` on `public.user_profiles`
  - `CREATE`/`DROP` in the `analytics` schema

## Setup

Install dbt in an isolated environment (kept off the FastAPI dependency graph):

```bash
python -m venv .venv-dbt
source .venv-dbt/bin/activate
pip install "dbt-core>=1.7" "dbt-postgres>=1.7"
```

Copy `profiles.yml.example` into `~/.dbt/profiles.yml` (or point
`DBT_PROFILES_DIR` at a directory containing it) and set the environment
variables from the root `.env.example` block.

Install dbt packages:

```bash
dbt deps
```

## Commands

```bash
dbt debug                # verify connection
dbt compile              # render SQL without executing
dbt build                # run models, then run tests
dbt docs generate        # produce docs; use `dbt docs serve` to view locally
```

`dbt build` must pass before MVP 2 is considered complete.

## Models

| Model | Layer | Grain | Notes |
| --- | --- | --- | --- |
| `stg_user_profiles` | staging | one row per user | Excludes `email` and `avatar_url` |
| `dim_users` | mart | one row per user | Analytics-safe user dimension |
| `fct_daily_user_signups` | mart | one row per (signup_date, auth_provider) | Daily signup count |

## Permissions boundary

dbt does not need — and must not be granted — Supabase auth-schema access,
service-role keys, or any secret used by FastAPI. See the root README for the
overall permission model.
