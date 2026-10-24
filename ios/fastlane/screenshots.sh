#!/bin/sh
# App Store screenshots from the simulator, using the app's DEBUG-only demo data
# (CELIADOR_UI_DEMO=<screen>; see Celiador/DemoData.swift and CeliadorApp.swift).
#
# Produces fastlane/screenshots/en-US/<n>_<screen>.png at the iPhone 6.9" size
# (1320×2868, iPhone 16 Pro Max simulator), which is the one size the App Store
# requires for an iPhone-only app. Run from the repo root or fastlane/.
#
#   ./fastlane/screenshots.sh            # all screens
#   ./fastlane/screenshots.sh session    # one screen
set -eu

cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-beta.app/Contents/Developer}"
DEVICE="${SCREENSHOT_DEVICE:-iPhone 16 Pro Max}"
OUT="fastlane/screenshots/en-US"
BUNDLE_ID="ai.celiador.companion.dev"        # the Dev configuration (the scheme's debug build) = Dev channel
SCREENS="${1:-queue session changes explorer code account}"

mkdir -p "$OUT"
UDID=$(xcrun simctl list devices available | grep "$DEVICE (" | head -1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/')
[ -n "$UDID" ] || { echo "no simulator named '$DEVICE'"; exit 1; }

echo "→ generating project"
xcodegen generate >/dev/null

echo "→ resolving packages and building Dev for the simulator"
xcodebuild -project Celiador.xcodeproj -scheme Celiador -derivedDataPath build/screenshots \
  -resolvePackageDependencies >/dev/null
xcodebuild -project Celiador.xcodeproj -scheme Celiador -configuration Dev \
  -destination "platform=iOS Simulator,id=$UDID" -derivedDataPath build/screenshots \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | grep -E "error:|warning: unable|BUILD" || true
APP=$(find build/screenshots/Build/Products/Dev-iphonesimulator -maxdepth 1 -name "*.app" 2>/dev/null | head -1)
[ -n "$APP" ] || { echo "build failed"; exit 1; }

echo "→ booting $DEVICE"
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance dark
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl install "$UDID" "$APP"

n=1
for screen in $SCREENS; do
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true
  # The default (TabShell) is the queue; named modes jump straight to one screen.
  mode="$screen"; [ "$screen" = "queue" ] && mode="1"
  SIMCTL_CHILD_CELIADOR_UI_DEMO="$mode" xcrun simctl launch "$UDID" "$BUNDLE_ID" >/dev/null
  sleep 3
  file="$OUT/$(printf '%02d' "$n")_${screen}.png"
  xcrun simctl io "$UDID" screenshot --type png "$file" >/dev/null
  echo "   $file"
  n=$((n + 1))
done
xcrun simctl status_bar "$UDID" clear
echo "→ done: $(ls "$OUT" | wc -l | tr -d ' ') screenshots in $OUT"
