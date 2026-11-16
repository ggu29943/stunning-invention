#!/usr/bin/env bash
# Build the Android app (android/: a full-screen landscape WebView with the
# web game bundled inside) into dist/apk/heelstomp.apk, plus
# dist/apk/version.json for the app's update check.
# Needs a JDK 17+ and the Android SDK (ANDROID_HOME) with platform 35.
# Optional: APK_VERSION_CODE (default 1), APK_VERSION_NAME (default: commit),
# APK_UPDATE_URL (web folder that will hold version.json + heelstomp.apk).
set -euo pipefail
cd "$(dirname "$0")/.."
export APK_VERSION_CODE="${APK_VERSION_CODE:-1}"
export APK_VERSION_NAME="${APK_VERSION_NAME:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
tools/build_site.sh android/app/src/main/assets/www
(cd android && ${GRADLE:-./gradlew} --no-daemon --console=plain assembleRelease)
mkdir -p dist/apk
cp android/app/build/outputs/apk/release/app-release.apk dist/apk/heelstomp.apk
printf '{"versionCode": %d, "versionName": "%s", "apk": "heelstomp.apk"}\n' \
  "$APK_VERSION_CODE" "$APK_VERSION_NAME" > dist/apk/version.json
echo "APK built: dist/apk/heelstomp.apk ($(du -h dist/apk/heelstomp.apk | cut -f1), version $APK_VERSION_NAME / $APK_VERSION_CODE)"
