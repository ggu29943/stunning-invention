#!/usr/bin/env bash
# Build the Android app (android/: a full-screen landscape WebView with the
# web game bundled inside) into dist/apk/heelstomp.apk, plus
# dist/apk/version.json for the app's update check.
# Needs a JDK 17+ and the Android SDK (ANDROID_HOME) with platform 35.
# The version moves only when the game or the app changes (commits to the
# files below), so a commit to anything else (README, CI) doesn't make the
# installed app offer a pointless update: version code = 1000 + the number of
# such commits (needs the full history, not a shallow clone), version name =
# the last of them.
# Optional overrides: APK_VERSION_CODE, APK_VERSION_NAME,
# APK_UPDATE_URL (web folder that will hold version.json + heelstomp.apk).
set -euo pipefail
cd "$(dirname "$0")/.."
INPUTS="index.html style.css manifest.webmanifest src assets/sprites assets/icons android tools/build_site.sh tools/build_apk.sh"
# shellcheck disable=SC2086
export APK_VERSION_CODE="${APK_VERSION_CODE:-$((1000 + $(git rev-list --count HEAD -- $INPUTS 2>/dev/null || echo 0)))}"
# shellcheck disable=SC2086
export APK_VERSION_NAME="${APK_VERSION_NAME:-$(git log -1 --format=%h -- $INPUTS 2>/dev/null || echo dev)}"
tools/build_site.sh android/app/src/main/assets/www
(cd android && ${GRADLE:-./gradlew} --no-daemon --console=plain assembleRelease)
mkdir -p dist/apk
cp android/app/build/outputs/apk/release/app-release.apk dist/apk/heelstomp.apk
printf '{"versionCode": %d, "versionName": "%s", "apk": "heelstomp.apk"}\n' \
  "$APK_VERSION_CODE" "$APK_VERSION_NAME" > dist/apk/version.json
echo "APK built: dist/apk/heelstomp.apk ($(du -h dist/apk/heelstomp.apk | cut -f1), version $APK_VERSION_NAME / $APK_VERSION_CODE)"
