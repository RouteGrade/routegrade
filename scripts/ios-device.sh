#!/usr/bin/env bash
#
# Build, sign, and install RouteGrade on a physical iPhone — from the CLI.
#
#   ./scripts/ios-device.sh
#   CAP_SERVER_URL=http://10.0.0.158:3000 ./scripts/ios-device.sh   # local dev server
#
# One-time setup this script cannot do for you:
#
#   1. Add your Apple ID to Xcode once (Xcode > Settings > Accounts > "+").
#      This creates the signing certificate. A free Apple ID works; the
#      resulting build expires after 7 days and must be reinstalled.
#   2. On the iPhone: Settings > Privacy & Security > Developer Mode > On,
#      then reboot. Required on iOS 16+ before any dev build will launch.
#   3. Plug the phone in and tap "Trust This Computer".
#
# After that this script is the whole loop — Xcode never needs to open again.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$REPO_ROOT/apps/web"

# Default to the deployed origin, not a local dev server. A phone is not on the
# Mac's loopback, and reaching the Mac over Wi-Fi additionally requires opening
# the macOS firewall. Vercel sidesteps both and is HTTPS, which keeps App
# Transport Security happy without any ATS exemption.
CAP_SERVER_URL="${CAP_SERVER_URL:-https://routegrade-web.vercel.app}"
DERIVED="$WEB_DIR/ios/.build-device"

cd "$WEB_DIR"

# --- Resolve the signing team ------------------------------------------------
# Xcode stores teams for every signed-in Apple ID. A free account shows up here
# with teamType "Individual" once the Apple ID has been added.
TEAM="${DEVELOPMENT_TEAM:-$(defaults read com.apple.dt.Xcode IDEProvisioningTeams 2>/dev/null \
  | grep -oE '"teamID"[^;]*' | head -1 | grep -oE '[A-Z0-9]{10}' || true)}"

if [ -z "$TEAM" ]; then
  cat >&2 <<'EOF'
No signing team found.

Add your Apple ID once: Xcode > Settings > Accounts > "+" > Apple ID.
That is the only step in this whole pipeline that needs the Xcode GUI.

Then re-run, or pass the team explicitly:
  DEVELOPMENT_TEAM=XXXXXXXXXX ./scripts/ios-device.sh
EOF
  exit 1
fi
echo "==> Signing team: $TEAM"

# --- Resolve the device ------------------------------------------------------
# Match the identifier by shape rather than column position: device names
# contain spaces ("Nitpreet's iPhone"), which shifts every positional field.
# Accepts both the CoreDevice UUID and the 00008030-XXXXXXXXXXXXXXXX hardware
# UDID that newer phones report.
UDID="${IOS_DEVICE_UDID:-$(xcrun devicectl list devices 2>/dev/null \
  | grep -i 'connected' \
  | grep -oiE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}|[0-9A-F]{8}-[0-9A-F]{16}' \
  | head -1)}"

if [ -z "$UDID" ]; then
  echo "No connected iPhone found. Plug it in, unlock it, and tap 'Trust This Computer'." >&2
  echo "Then confirm it appears here:  xcrun devicectl list devices" >&2
  exit 1
fi
echo "==> Device: $UDID"

echo "==> Syncing Capacitor (server: $CAP_SERVER_URL)"
CAP_SERVER_URL="$CAP_SERVER_URL" npx cap sync ios

echo "==> Building and signing for device"
# -allowProvisioningUpdates lets xcodebuild create/refresh the provisioning
# profile itself. Without it, profile management is an Xcode GUI task.
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Debug \
  -destination "id=$UDID" \
  -derivedDataPath "$DERIVED" \
  -allowProvisioningUpdates \
  -skipMacroValidation \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  build

APP="$DERIVED/Build/Products/Debug-iphoneos/App.app"
BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$APP/Info.plist")"

echo "==> Installing $BUNDLE_ID"
xcrun devicectl device install app --device "$UDID" "$APP"

echo "==> Launching"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID"

cat <<EOF

Installed and launched on device.

If iOS refuses to open it with an untrusted-developer warning, approve the
certificate once on the phone:
  Settings > General > VPN & Device Management > (your Apple ID) > Trust

With a free Apple ID this build stops launching after 7 days. Re-run this
script to reinstall — no Xcode, no re-signing by hand.
EOF
