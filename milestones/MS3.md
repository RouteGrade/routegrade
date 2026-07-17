# RouteGrade MVP 3 — Real Routes: Generation, Scoring & Saved Runs

Spec source: "MVP 3 — Real Routes: Generation, Scoring & Saved Runs" (Notion
draft). This file records what shipped and where.

## Objective

Turn RouteGrade from a walking skeleton into a real running-route assistant:
the map form generates real geometries from a real starting point, computes a
first-pass quality grade, and signed-in users can save and revisit routes.

## Phase 0 decisions

Recorded in `docs/routing-setup.md`: Nominatim-shape geocoding (managed
provider swappable), OSRM routing (self-hosted `foot` profile in production),
Open-Elevation, FastAPI on-demand scoring, JSONB geometry storage.

## What shipped

### Backend (`services/api`)

- `app/providers/` — `NominatimGeocoder`, `OSRMRoutingEngine` (triangle-loop
  generation with iterative radius rescaling), `OpenElevationClient`, all
  behind protocols for testability.
- `app/services/scoring.py` — scoring v1 (see `docs/scoring.md`).
- `app/services/route_planner.py` — geocode → 3 bearing-seeded candidates →
  elevation → score; in-tolerance candidates rank first.
- `POST /v1/routes/plan` — public, per the spec; 404 for unknown addresses,
  502 for provider outages. Rate limiting is a documented pre-launch TODO.
- `GET/PUT/DELETE /v1/users/me/routes[/:id]` — Bearer-auth, owner-scoped;
  401 + `WWW-Authenticate: Bearer` matches MVP 2 conventions; PUT is an
  idempotent save/replace keyed on the planner-issued route id (201 on create,
  409 if the id belongs to another user).
- Alembic `0002_create_saved_routes` — `public.saved_routes` per the spec's
  data model, with check constraints and **owner-only RLS policies**
  (`auth.uid() = user_id` for select/insert/update/delete). The FastAPI
  trusted role bypasses RLS.

### Frontend (`apps/web`)

- Route form drives real `POST /v1/routes/plan`; result card shows real grade,
  elevation, and distance, with a candidate switcher and an "Off target" badge
  for out-of-tolerance routes.
- Signed-out users still get the full plan experience; **Save** becomes a
  "Sign in to save this route" CTA.
- `/account` gains a **Saved routes** list (grade chip, distance, climb,
  delete) with an empty state; clicking an entry reopens it on the map via
  `/?route=<id>`.
- The MVP 1 sample-route fixture is gone.

### Analytics (`analytics/routegrade_dbt`)

- New source `routegrade_ops.saved_routes`.
- `stg_saved_routes` — **drops `starting_address` and `geometry`** so no PII
  or bulky traces reach marts.
- `dim_routes` — one row per saved route (grade, distance bucket, provider,
  signup_at). `fct_route_scores_daily` — per (saved_date, grade) counts and
  means.
- Tests: PK uniqueness, grade accepted set, `distance_km > 0`,
  `elevation_gain_m >= 0`, plus a singular non-negativity test on the fact.

## Testing

- `services/api`: 63 tests green (`pytest`) — scoring branch coverage
  (flat/hilly, dense/sparse, missing sidewalk data, degenerate geometry), plan
  endpoint with stubbed providers, saved-route CRUD incl. cross-user 404/409,
  all MVP 2 suites unchanged.
- `apps/web`: `next build` + `eslint` clean.
- dbt: `dbt parse` clean; `dbt build` requires a live Supabase connection.

## Deferred / known gaps

- Per-IP rate limiting and plan caching on `/v1/routes/plan` (pre-launch
  requirements, documented in `docs/routing-setup.md`).
- Sidewalk coverage input is neutral in v1 (no Overpass integration yet).
- Live-provider integration tests behind an env flag are not yet wired; all
  provider tests run against stubs.
