#!/usr/bin/env bash
#
# Build and run the RouteGrade iOS shell in the Simulator, without opening Xcode.
#
#   ./scripts/ios-sim.sh                 # against the local dev server
#   CAP_SERVER_URL=https://... ios-sim.sh  # against a deployed origin
#
# Xcode.app must be installed — Apple ships the only iOS compiler — but this
# script never launches it. `xcodebuild` and `simctl` are both CLI tools.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/web"

# The Simulator shares the Mac's network stack, so localhost reaches a dev
# server running on the host. On a physical device this must be the Mac's LAN
# IP instead — localhost there means the phone itself.
CAP_SERVER_URL="${CAP_SERVER_URL:-http://localhost:3000}"
DEVICE="${IOS_SIM_DEVICE:-iPhone 17 Pro}"
DERIVED="$WEB_DIR/ios/.build"

cd "$WEB_DIR"

echo "==> Booting '$DEVICE'"
# Resolve to a UDID first. The name anchor ends at " (" so "iPhone 17 Pro"
# does not also match "iPhone 17 Pro Max".
UDID="$(xcrun simctl list devices | awk -v d="$DEVICE" '$0 ~ d " \\(" {gsub(/[()]/,"",$(NF-1)); print $(NF-1); exit}')"
[ -n "$UDID" ] || { echo "Could not resolve a simulator named '$DEVICE'" >&2; exit 1; }

# `bootstatus -b` boots if needed and blocks until the device is actually
# usable. Plain `boot` returns immediately, and installing into a still-booting
# device fails with "Unable to lookup in current state: Shutdown".
xcrun simctl bootstatus "$UDID" -b >/dev/null

# Deliberately NOT `open -a Simulator`. simctl installs, launches, screenshots
# and injects input on a headless booted device, so the standalone Simulator.app
# window is not needed. Open it by hand if you want to poke at the device
# directly outside the Claude panel.

echo "==> Syncing Capacitor (server: $CAP_SERVER_URL)"
CAP_SERVER_URL="$CAP_SERVER_URL" npx cap sync ios

echo "==> Building (xcodebuild, headless)"
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination "id=$UDID" \
  -derivedDataPath "$DERIVED" \
  -skipMacroValidation \
  build

APP="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$APP/Info.plist")"

echo "==> Installing and launching $BUNDLE_ID"
xcrun simctl install "$UDID" "$APP"
xcrun simctl launch "$UDID" "$BUNDLE_ID"

cat <<EOF

Running. To stream the app's native logs:
  xcrun simctl spawn "$UDID" log stream --level debug --predicate 'subsystem CONTAINS "routegrade"'
EOF
