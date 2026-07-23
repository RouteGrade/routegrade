# OSRM cutover runbook — driving demo → self-hosted `foot`

> Also mirrored in Notion: [OSRM Cutover Runbook](https://app.notion.com/p/3a5dc99a2221817eb24cec6bc5f73344). This file is the source of truth; re-sync the Notion copy when this changes materially.

Operational runbook for switching `/v1/routes/plan` from the public OSRM demo
(`driving` profile) to a self-hosted `foot` instance. Owned by the founder;
executed once per host provisioning. Cutover itself is env-vars-only: no code
change or redeploy of application logic is needed.

- Code contract: only `OSRM_BASE_URL` and `OSRM_PROFILE` in Vercel env
  determine which OSRM the API talks to (`services/api/app/core/config.py`
  `osrm_base_url` / `osrm_profile`). This has been verified — no other file
  hardcodes either value.
- Loop-tolerance logic (`_INITIAL_PERIMETER_FACTOR = 3.4`, `_MAX_ATTEMPTS = 4`,
  ±10% flag) is profile-agnostic and has been verified against a real `foot`
  instance for 2–10 km loops in downtown Toronto (all within ±2.3%).

## Prerequisites

- VPS or Fly.io machine with a public IP or (preferred) an internal Vercel-
  reachable URL, and SSH access.
- Recent Docker + Docker Compose (v2 plugin).
- Ability to set env vars in the Vercel `routegrade-api` project (Production).

## Host sizing (Ontario extract)

Extract source: <https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf>
(currently ~970 MB; check `Content-Length` before provisioning).

| Resource | Minimum | Recommended | Notes |
| --- | --- | --- | --- |
| RAM | 4 GB | 8 GB | `osrm-extract` peaks near 1 GB on Toronto only; Ontario is ~10× larger. MLD keeps runtime RAM modest. |
| Disk | 15 GB | 25 GB | Processed OSRM files run ~5× the raw `.pbf` (Toronto: 101 MB → 475 MB; Ontario expected ~5 GB). Add space for the `.pbf` itself and one refresh cycle. |
| CPU | 2 vCPU | 2–4 vCPU | Extract/partition/customize are one-shot; steady-state `osrm-routed` is I/O bound. |
| Network egress | — | — | Vercel calls it; small responses (<50 KB). |

Hetzner CX22 (2 vCPU / 4 GB / 40 GB, ~€4/mo) or DigitalOcean $6 droplet fits
comfortably. Fly.io `shared-cpu-2x` with a 25 GB volume also works.

## Step-by-step provision

1. **SSH into the host, install Docker.**
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker "$USER" && exec su -l "$USER"
   ```

2. **Prepare the OSRM data directory and fetch the extract.**
   ```bash
   sudo mkdir -p /opt/osrm && sudo chown "$USER" /opt/osrm && cd /opt/osrm
   wget https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf
   ```

3. **Build the `foot` graph (three one-shot passes, ~10–30 min total).**
   ```bash
   docker run --rm -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend \
     osrm-extract -p /opt/foot.lua /data/ontario-latest.osm.pbf
   docker run --rm -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend \
     osrm-partition /data/ontario-latest
   docker run --rm -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend \
     osrm-customize /data/ontario-latest
   ```
   The first pass fails fast if the profile name is wrong — the file is
   `/opt/foot.lua` inside the image (verified against
   `ghcr.io/project-osrm/osrm-backend:latest`).

4. **Run `osrm-routed` under Docker Compose (auto-restart, MLD).**
   Write `/opt/osrm/docker-compose.yml`:
   ```yaml
   services:
     osrm:
       image: ghcr.io/project-osrm/osrm-backend
       command: osrm-routed --algorithm mld /data/ontario-latest
       volumes: ["/opt/osrm:/data"]
       ports: ["127.0.0.1:5000:5000"]  # bind localhost; reverse-proxy TLS in front
       restart: unless-stopped
   ```
   ```bash
   cd /opt/osrm && docker compose up -d
   ```

5. **Front it with TLS.** Terminate HTTPS with Caddy or nginx and forward to
   `127.0.0.1:5000`. Do not expose port 5000 directly — OSRM has no auth.
   A minimal Caddyfile:
   ```
   osrm.your-domain.com {
     reverse_proxy 127.0.0.1:5000
     # Optional: restrict to Vercel's egress ranges once known.
   }
   ```

6. **Health check.**
   ```bash
   curl -s "https://osrm.your-domain.com/route/v1/foot/-79.3832,43.6519;-79.3849,43.6515;-79.3832,43.6519?overview=false" \
     | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['code'], r['routes'][0]['distance'])"
   # Expected: Ok <positive number of metres>
   ```

## Vercel env switch (the actual cutover)

In the Vercel `routegrade-api` Production env, set:

```
OSRM_BASE_URL = https://osrm.your-domain.com
OSRM_PROFILE  = foot
```

Then redeploy (env changes only take effect on new deploys):

```bash
cd services/api && npx vercel deploy --prod --yes
```

That is the whole code-side cutover. No other var changes; no source edits.

## Post-cutover verification

Hit the API from your laptop (or Vercel logs — same effect):

1. **Health.**
   ```bash
   curl -s https://routegrade-api.vercel.app/healthz
   ```
   Expected: 200 `{"status": "ok"}`.

2. **Live plan against real Toronto address.**
   ```bash
   curl -s -X POST https://routegrade-api.vercel.app/v1/routes/plan \
     -H 'content-type: application/json' \
     -d '{"address":"Nathan Phillips Square, Toronto","distance_km":5,"preference":"quiet"}' \
     | python3 -m json.tool
   ```
   Expected shape:
   - `status 200`, three entries in `routes[]`.
   - Each route: `provider = "osrm"`, `distance_km` within `[4.5, 5.5]` (±10% of 5), `within_tolerance = true`, non-null `geometry.coordinates` (LineString), `grade` in `A|B|C|D`, `score` in `[0, 100]`.
   - Route names include the routed distance, e.g. `"East loop · 5.1 km"`.

3. **Cross-check pedestrian pace.** Sum `distance` / `duration` on the raw
   `/route` reply from your OSRM directly — should be ~1.3–1.5 m/s
   (~5 km/h). The demo `driving` profile returns ~13 m/s. This is the
   quickest way to visually confirm the profile actually flipped.

## Rollback

If `/v1/routes/plan` returns 502 `provider_error` after cutover, or the
OSRM host is unreachable:

1. In Vercel env, revert to the demo values:
   ```
   OSRM_BASE_URL = https://router.project-osrm.org
   OSRM_PROFILE  = driving
   ```
2. Redeploy: `cd services/api && npx vercel deploy --prod --yes`.
3. Grades will regress to the pre-cutover behaviour (driving maneuver density
   → generally softer scores). This is a temporary state — the demo server
   is rate-limited and not for production use — but restores service.

## Known scoring caveats on `foot` (not a cutover blocker)

Local verification against downtown Toronto (Nathan Phillips Square,
`foot`, MLD) shows the intersection-density proxy runs 9–14 maneuvers/km
across 2–10 km loops. The scoring v1 "0-point" anchor sits at 12/km
(see `docs/scoring.md`), so many pedestrian loops in dense downtowns will
land in the D band on this input alone. Behaviour is expected and
consistent with the v1 heuristic — real intersection counts and anchor
recalibration are tracked under Phase A in the Backlog database in Notion.
No cutover
change addresses this.
