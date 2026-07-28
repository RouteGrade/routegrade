#!/usr/bin/env bash
#
# Build the foot-profile OSRM graph: extract -> partition -> customize.
#
# Idempotent: the download is skipped when the .pbf is already present, and the
# three passes are safe to re-run (each overwrites its own outputs). Run this
# once per host provisioning (and again to refresh the map data). Total time is
# ~10-30 min on the Ontario extract; RAM peaks during osrm-extract.
#
# Usage:
#   cp .env.example .env    # adjust OSRM_EXTRACT_URL / OSRM_DATASET if needed
#   ./build-graph.sh
#   docker compose up -d
#
set -euo pipefail
cd "$(dirname "$0")"

# Load config if present; env vars already set in the shell win.
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi

OSRM_EXTRACT_URL="${OSRM_EXTRACT_URL:?set OSRM_EXTRACT_URL (see .env.example)}"
OSRM_DATASET="${OSRM_DATASET:?set OSRM_DATASET (see .env.example)}"
OSRM_IMAGE="${OSRM_IMAGE:-ghcr.io/project-osrm/osrm-backend:latest}"
DATA_DIR="${OSRM_DATA_DIR:-./data}"

# Resolve DATA_DIR to an absolute path for the Docker bind mount.
mkdir -p "$DATA_DIR"
DATA_DIR="$(cd "$DATA_DIR" && pwd)"

PBF="$DATA_DIR/${OSRM_DATASET}.osm.pbf"
if [ ! -f "$PBF" ]; then
  echo "==> Fetching extract: $OSRM_EXTRACT_URL"
  wget -O "$PBF" "$OSRM_EXTRACT_URL"
else
  echo "==> Extract already present, skipping download: $PBF"
fi

run() { docker run --rm -t -v "$DATA_DIR:/data" "$OSRM_IMAGE" "$@"; }

# osrm-extract fails fast if the profile path is wrong; /opt/foot.lua ships in
# the osrm-backend image.
echo "==> osrm-extract (foot profile)"
run osrm-extract -p /opt/foot.lua "/data/${OSRM_DATASET}.osm.pbf"
echo "==> osrm-partition"
run osrm-partition "/data/${OSRM_DATASET}"
echo "==> osrm-customize"
run osrm-customize "/data/${OSRM_DATASET}"

echo "==> Graph built in $DATA_DIR"
echo "==> Next: 'docker compose up -d', then ./healthcheck.sh"
