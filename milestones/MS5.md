# RouteGrade MVP 5 — Live Run Tracking

Shipped in commit `da6bf78` (2026-07-18), on top of MVP 4's public deployment:
**Nike-Run-Club-style run tracking**. Pick a route, get a countdown, run it
with live stats, audio cues, and off-route guidance, and keep a run history on
your account.

## What shipped (2026-07-18)

### Run tracker (`apps/web/src/components/run-tracker.tsx`)

- **Start run** on the route card launches a full-screen tracker over the map;
  the planner UI hides while a run is live. Speech synthesis is primed inside
  the click handler because iOS/Safari only allow speech after a user gesture.
- 3-2-1-GO countdown, then live GPS via `watchPosition` (high accuracy) with
  quality gates: fixes worse than 60 m accuracy are ignored for distance math,
  sub-jitter movement (< max(2.5 m, accuracy/4)) is dropped, and > 10 m/s
  teleport glitches are discarded.
- Live stats: moving time, distance, average pace, and current pace over a
  40 s rolling window.
- Per-kilometer splits, each announced with its spoken pace.
- Off-route guidance with hysteresis: alert past 50 m from the route (banner +
  voice, re-spoken at most every 15 s), recovery under 30 m; a progress bar
  shows distance remaining along the route.
- Pause / resume / finish — the clock counts moving time only. A screen wake
  lock is held while running and re-acquired when the tab becomes visible.
- Finish summary: distance, time, average pace, and the split list, with
  **Save this run** for signed-in users or a sign-in CTA otherwise — tracking
  itself works signed-out, mirroring the plan-public / save-auth split.
- Mute toggle for audio cues; GPS permission/signal problems surface inline.
- `?simulate=1` dev mode drives a virtual runner along the route at ~3.2 m/s
  (~5:12/km) so the entire flow is exercisable without leaving a desk.

### Map (`apps/web/src/components/route-map.tsx`)

- Runner dot marker and a traveled-path trace layer fed by run telemetry.
- Camera follow while running; a user pan/zoom suspends follow (the map never
  fights the runner's fingers) until Re-center is tapped.

### Geo helpers (`apps/web/src/lib/geo.ts`)

Haversine distance, path length, point-onto-polyline projection (local
equirectangular — powers off-route detection and progress), and pace/duration
formatting including the spoken form for audio cues.

### Backend (`services/api`)

- `GET/PUT/DELETE /v1/users/me/runs[/:id]` (`app/api/routes/runs.py`) —
  Bearer-auth, owner-scoped, matching the saved-routes conventions: PUT is an
  idempotent save keyed on the client-issued UUID (201 on create, 409 if the
  id belongs to another user), the list is newest-first, delete returns
  204/404.
- Validation caps on `RunSave` (`app/schemas/runs.py`): `duration_s` and pace
  ≤ 24 h, `distance_km` ≤ 999.999, ≤ 1000 splits, route name ≤ 120 chars,
  unknown fields rejected.
- New repository and model: `app/repositories/runs.py`,
  `app/db/models/run.py`.
- Alembic `0003_create_runs` — `public.runs`: `route_id` is a loose pointer
  (no FK) so deleting a saved route keeps run history intact; `user_id` FK →
  `auth.users` with CASCADE; splits and the GPS trace stored as JSONB (PostGIS
  still deferred per the Phase 0 decision); check constraints on duration,
  distance, and pace; **owner-only RLS policies** in the same shape as
  `saved_routes`; `ix_runs_user_id` index.

### Account page (`apps/web/src/app/account/runs-section.tsx`)

- New **Your runs** history section: per-run date, distance, duration, and
  pace, with delete and an empty state that points back to the map.

## Verification

- `services/api`: 80 tests green (`uv run pytest`, re-verified 2026-07-21),
  including 13 new run-API tests — auth required on every method,
  create-then-replace, owner scoping and newest-first ordering, cross-user
  409, and validation rejects. `ruff check` clean.
- `apps/web`: `eslint` and `next build` clean (re-verified 2026-07-21).
- The run tracker itself has no automated frontend tests — a `?simulate=1`
  regression suite is queued in `docs/BACKLOG.md`.

## Deferred / known gaps

- No analytics coverage for `public.runs` — the dbt project has no source,
  staging model, or marts for runs yet (backlog P1).
- `/v1/users/me/runs` is not rate-limited (only `/v1/routes/plan` is), and the
  GPS `path` LineString has no explicit coordinate-count cap — a security
  review of the MVP 5 surface is queued in the backlog.
- Carried forward from MS4: the Supabase Auth redirect allow-list entry for
  production sign-in remains a manual step; OSRM must be self-hosted with the
  `foot` profile before promoting beyond a demo audience; the plan rate-limit
  bucket is still per serverless instance (Redis upgrade path in
  `docs/deployment.md`).
