#!/usr/bin/env bash
# The game's version number, shared by the web page (设置 shows it) and the
# Android app (its versionCode, which the app's update check compares):
# 1000 + the number of commits that changed the game or the app. A commit to
# anything else (README, CI) keeps the number, so an installed app does not
# offer a pointless update. Prints "<number> <last such commit>".
# Needs the full history: in a shallow clone it fails instead of printing a
# number that is far too low (an app would then never see its updates).
set -euo pipefail
cd "$(dirname "$0")/.."
INPUTS="index.html style.css manifest.webmanifest src assets/sprites assets/icons android tools/build_site.sh tools/build_apk.sh tools/app_version.sh"
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != false ]; then
  echo "app_version.sh: needs the full git history (git fetch --unshallow; in Actions: fetch-depth: 0)" >&2
  exit 1
fi
# shellcheck disable=SC2086
echo "$((1000 + $(git rev-list --count HEAD -- $INPUTS))) $(git log -1 --format=%h -- $INPUTS)"
