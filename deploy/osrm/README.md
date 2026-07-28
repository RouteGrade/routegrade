# Self-hosted `foot`-profile OSRM — turnkey

This directory provisions the self-hosted OSRM instance that RouteGrade's grading
depends on. Production still points at the public OSRM **demo** server, which only
serves the `driving` profile — and a car router collapses every route onto a few
arterials, so intersection density (our street-crossing proxy) comes back nearly
constant and **most routes grade into the same band**. Switching to a self-hosted
`foot` instance is the root fix for that live grade-quality bug.

These files turn the [OSRM cutover runbook](../../docs/OSRM_CUTOVER_RUNBOOK.md)'s
~15 hand-typed commands into a copy-and-run. The runbook remains the reference for
host sizing, TLS, rollback, and the post-cutover API verification.

## What's here

| File | Purpose |
| --- | --- |
| `.env.example` | Region extract URL, dataset name, bind address, image. Copy to `.env`. |
| `build-graph.sh` | Fetch the extract (idempotent) and run extract → partition → customize. |
| `docker-compose.yml` | Run `osrm-routed` (MLD), localhost-bound, auto-restart. |
| `Caddyfile.example` | Minimal TLS reverse proxy in front of OSRM. |
| `healthcheck.sh` | Confirm the host is up **and** actually pedestrian-paced. |

## Quickstart (on the host)

Provision a small VPS first — Hetzner CX22 (2 vCPU / 4 GB, ~€4/mo) or a $6
DigitalOcean droplet is plenty for the Ontario extract. Then:

```bash
# 1. Install Docker (skip if present)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER" && exec su -l "$USER"

# 2. Copy this directory to the host and enter it
scp -r deploy/osrm you@host:~/osrm && ssh you@host
cd ~/osrm

# 3. Configure and build the foot graph (~10-30 min)
cp .env.example .env        # edit only if you want a different region
./build-graph.sh

# 4. Serve it
docker compose up -d
./healthcheck.sh            # expects: OK: foot profile confirmed

# 5. Put TLS in front (see Caddyfile.example), then flip the two Vercel vars:
#      OSRM_BASE_URL = https://osrm.your-domain.com
#      OSRM_PROFILE  = foot
#    and redeploy the API. That env switch is the entire code-side cutover.
```

Full detail — host sizing table, TLS hardening, the Vercel redeploy command,
post-cutover API checks, and rollback — lives in the
[cutover runbook](../../docs/OSRM_CUTOVER_RUNBOOK.md).

## Notes

- **`data/` is git-ignored** — the `.pbf` and processed graph (several GB) live
  only on the host, never in the repo.
- **Refresh the map** by deleting `data/<dataset>.osm.pbf` and re-running
  `build-graph.sh` (or just re-run it after `rm` — the download is the only
  skipped-when-present step), then `docker compose restart`.
- **Pin the image** (`OSRM_IMAGE=…:v6.0.0` in `.env`) for reproducible rebuilds;
  `:latest` matches the image the runbook was verified against.
