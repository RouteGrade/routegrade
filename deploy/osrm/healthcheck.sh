#!/usr/bin/env bash
#
# Confirm the OSRM host is up AND actually serving the foot profile.
#
# The quickest tell that the profile flipped is pedestrian pace: foot routes come
# back at ~1.3-1.5 m/s, whereas the driving demo returns ~13 m/s. This routes a
# short out-and-back in downtown Toronto and checks both the code and the speed.
#
# Usage:
#   ./healthcheck.sh                       # against http://127.0.0.1:5000
#   ./healthcheck.sh https://osrm.your-domain.com
#
set -euo pipefail
BASE="${1:-http://127.0.0.1:5000}"
URL="$BASE/route/v1/foot/-79.3832,43.6519;-79.3849,43.6515;-79.3832,43.6519?overview=false"

curl -fsS "$URL" | python3 -c '
import sys, json
r = json.load(sys.stdin)
if r.get("code") != "Ok" or not r.get("routes"):
    print("FAIL: unexpected response:", json.dumps(r)[:200]); sys.exit(1)
route = r["routes"][0]
dist, dur = float(route["distance"]), float(route["duration"])
speed = dist / dur if dur else 0.0
print(f"code=Ok distance_m={dist:.0f} duration_s={dur:.0f} speed_mps={speed:.2f}")
if not (0.8 <= speed <= 2.2):
    print(f"FAIL: {speed:.2f} m/s is not pedestrian pace (~1.3-1.5) - wrong profile?")
    sys.exit(1)
print("OK: foot profile confirmed")
'
