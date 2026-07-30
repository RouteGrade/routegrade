# Routing setup — providers, env vars, and Phase 0 decisions

> Also mirrored in Notion: [Routing Setup](https://app.notion.com/p/3a5dc99a222181d08c66cc8356ed88f3). This file is the source of truth; re-sync the Notion copy when this changes materially.

MVP 3 replaced the hard-coded sample route with real generation:
`POST /v1/routes/plan` orchestrates **geocode → route candidates → elevation →
scoring** and returns scored GeoJSON loops.

## Phase 0 decision record

| Decision | Chosen | Rationale |
| --- | --- | --- |
| Geocoding provider | **Nominatim API shape** (public instance for dev, self-host or Mapbox later) | Keyless local dev; the `Geocoder` protocol in `app/providers/base.py` lets Mapbox slot in without touching the planner. |
| Routing engine | **OSRM HTTP API** (self-hosted in production) | Predictable cost, offline-friendly for tests. The public demo server only serves the `driving` profile — self-host with `foot` for real runs. |
| Elevation source | **Open-Elevation** | Keyless and self-hostable; migrate to SRTM tiles in PostGIS if volume outgrows it. |
| Scoring location | **FastAPI on-demand** for `/plan`; dbt only aggregates | Per-request semantics; dbt is batch. |
| Geometry storage | **JSONB (GeoJSON LineString)** | Reading a saved route needs no spatial queries yet; upgrade to PostGIS when "routes near me" lands (MVP 4+). |

## Environment variables (`services/api/.env`)

| Variable | Default | Notes |
| --- | --- | --- |
| `GEOCODER_BASE_URL` | `https://nominatim.openstreetmap.org` | Any Nominatim-compatible endpoint. |
| `GEOCODER_USER_AGENT` | `RouteGrade/0.1 (routegrade-api)` | Required by Nominatim's usage policy — set a real contact. |
| `OSRM_BASE_URL` | `https://router.project-osrm.org` | Point at your self-hosted OSRM in production. |
| `OSRM_PROFILE` | `foot` | Public demo only serves `driving`. |
| `ELEVATION_BASE_URL` | `https://api.open-elevation.com` | Any Open-Elevation-compatible endpoint. |
| `PROVIDER_TIMEOUT_SECONDS` | `10` | Per outbound call. |
| `ROUTE_PLAN_DISTANCE_TOLERANCE` | `0.10` | Documented ±10% target; out-of-tolerance candidates are flagged, not hidden. |

## ⚠️ The public demo server ignores `OSRM_PROFILE` entirely

This is the single most important thing on this page, because it fails
**silently** — no error, no warning, just wrong grades.

`https://router.project-osrm.org` serves one graph (driving) and returns it
whatever profile you put in the URL path. Measured 2026-07-29, same coordinate
pair, `overview=false`:

| Profile in URL | Result |
| --- | --- |
| `foot` | `code=Ok` · 1279.1 m · 150.7 s |
| `driving` | `code=Ok` · 1279.1 m · 150.7 s |
| `bicycle` | `code=Ok` · 1279.1 m · 150.7 s |
| `nonsense` | `code=Ok` · 1279.1 m · 150.7 s |

Byte-identical, including for a profile that does not exist. And 1279 m in
150.7 s is **8.5 m/s — about 30 km/h**, which is a car; on foot that leg is
roughly thirteen minutes.

So setting `OSRM_PROFILE=foot` against the default `OSRM_BASE_URL` is a no-op.
You get car routing wearing a foot label, and nothing in the config, the logs,
or the response tells you. That is the root cause of grades clustering into one
band: intersection density is derived from routing manoeuvres per km, and a car
router collapses onto arterials with few turns no matter what the street grid
actually looks like.

**A `foot` profile only exists once you self-host.** The API now logs a warning
at startup when it detects this combination (`app/main.py`), so the failure is
at least visible.

## Self-hosting OSRM (production / offline dev)

Use the turnkey tooling in [`deploy/osrm/`](../deploy/osrm/README.md) — it
supersedes the hand-rolled `docker run` sequence this section used to carry.
It ships `build-graph.sh` (fetch extract → `osrm-extract -p /opt/foot.lua` →
partition → customize), a `docker-compose.yml` to serve it, `healthcheck.sh`,
and `Caddyfile.example` for TLS.

For the production cutover specifically — host sizing, step-by-step provision,
the Vercel env switch, verification and rollback — follow
[`docs/OSRM_CUTOVER_RUNBOOK.md`](./OSRM_CUTOVER_RUNBOOK.md).

Once it is serving:

```bash
OSRM_BASE_URL=http://localhost:5000   # or https://osrm.your-domain.com
OSRM_PROFILE=foot                     # now actually meaningful
```

## How loop generation works

`OSRMRoutingEngine.generate_loop` projects two waypoints ~⅓ of the requested
distance from the start, 60° apart around a seed bearing, and routes
start → w1 → w2 → start. The routed distance is compared to the request and the
radius is rescaled up to 4 times until the loop lands within ±5% (the endpoint
then flags anything outside the configured ±10% tolerance). Three seed bearings
(20°, 140°, 260°) produce three genuinely different candidates per request.

## Known pre-launch requirements

**Built and verified in production:**

- **Per-IP rate limiting on `/v1/routes/plan`** — wired via
  `enforce_plan_rate_limit` (`app/api/routes/plans.py`), 10/min sustained plus
  5 burst by default. Confirmed live 2026-07-29: 20 parallel requests returned
  exactly 15×200 + 5×429, and `scripts/smoke-test.sh` now checks it on every
  run. (That check reported a false FAIL for a long time — it bursted serially
  against a ~9 s endpoint, so the bucket refilled faster than it drained. Fixed
  in PR #42.)

**Still outstanding:**

- **Plan caching.** Identical `(start, distance, preference)` requests should
  reuse a computed route (lightweight `route_plans` cache table) to cut
  provider spend. Not built — there is no `route_plans` table in production.
- **OSM data currency audit for Toronto** before committing to OSM-only inputs.
