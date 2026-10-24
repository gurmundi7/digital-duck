#!/bin/zsh
# The dev Electron.app ships without the usage strings macOS requires before
# it will even ask for Calendar or Apple Events (osascript) access. Add them
# and re-sign ad hoc. Run after every `npm install` (postinstall does).
set -e
APP="$(dirname "$0")/../node_modules/electron/dist/Electron.app"
PLIST="$APP/Contents/Info.plist"
[ -f "$PLIST" ] || { echo "no Electron.app"; exit 0; }
add() { /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" >/dev/null 2>&1 || /usr/libexec/PlistBuddy -c "Add :$1 string '$2'" "$PLIST"; }
add NSCalendarsUsageDescription "Digital Duck reads your calendar to remind you before meetings."
add NSCalendarsFullAccessUsageDescription "Digital Duck reads your calendar to remind you before meetings."
add NSAppleEventsUsageDescription "Digital Duck drives other apps when you ask it to."
add NSMicrophoneUsageDescription "Digital Duck listens when you press the talk key."
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Digital Duck" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Digital Duck" "$PLIST"
codesign --force --deep --sign - "$APP" 2>&1 | grep -v "replacing existing signature" || true
echo "patched $(basename "$APP")"
