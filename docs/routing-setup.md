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

## Self-hosting OSRM (production / offline dev)

```bash
# Ontario extract covers downtown Toronto (the MVP 3 service area).
wget https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf
docker run -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/foot.lua /data/ontario-latest.osm.pbf
docker run -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/ontario-latest.osrm
docker run -t -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/ontario-latest.osrm
docker run -t -i -p 5000:5000 -v $(pwd):/data ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/ontario-latest.osrm
# then: OSRM_BASE_URL=http://localhost:5000  OSRM_PROFILE=foot
```

## How loop generation works

`OSRMRoutingEngine.generate_loop` projects two waypoints ~⅓ of the requested
distance from the start, 60° apart around a seed bearing, and routes
start → w1 → w2 → start. The routed distance is compared to the request and the
radius is rescaled up to 4 times until the loop lands within ±5% (the endpoint
then flags anything outside the configured ±10% tolerance). Three seed bearings
(20°, 140°, 260°) produce three genuinely different candidates per request.

## Known pre-launch requirements (tracked, not yet built)

- **Per-IP rate limiting on `/v1/routes/plan`.** The endpoint is public and each
  call fans out to three external providers. Do not launch publicly without it.
- **Plan caching.** Identical `(start, distance, preference)` requests should
  reuse a computed route (lightweight `route_plans` cache table) to cut
  provider spend.
- **OSM data currency audit for Toronto** before committing to OSM-only inputs.
