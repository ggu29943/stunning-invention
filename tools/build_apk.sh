#!/usr/bin/env bash
# Build the Android app (android/: a full-screen landscape WebView with the
# web game bundled inside) into dist/apk/heelstomp.apk, plus
# dist/apk/version.json for the app's update check.
# Needs a JDK 17+ and the Android SDK (ANDROID_HOME) with platform 35.
# Version: tools/app_version.sh (moves only when the game or the app changes;
# needs the full git history). Optional overrides: APK_VERSION_CODE,
# APK_VERSION_NAME, APK_UPDATE_URL (web folder that will hold version.json +
# heelstomp.apk).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${APK_VERSION_CODE:-}" ]; then
  VERSION="$(tools/app_version.sh)" # stops here in a shallow clone
  export APK_VERSION_CODE="${VERSION% *}"
  export APK_VERSION_NAME="${APK_VERSION_NAME:-${VERSION#* }}"
fi
export APK_VERSION_NAME="${APK_VERSION_NAME:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
# (build_site.sh writes the same number into the page, for 设置)
tools/build_site.sh android/app/src/main/assets/www
(cd android && ${GRADLE:-./gradlew} --no-daemon --console=plain assembleRelease)
mkdir -p dist/apk
cp android/app/build/outputs/apk/release/app-release.apk dist/apk/heelstomp.apk
printf '{"versionCode": %d, "versionName": "%s", "apk": "heelstomp.apk"}\n' \
  "$APK_VERSION_CODE" "$APK_VERSION_NAME" > dist/apk/version.json
echo "APK built: dist/apk/heelstomp.apk ($(du -h dist/apk/heelstomp.apk | cut -f1), version $APK_VERSION_NAME / $APK_VERSION_CODE)"
