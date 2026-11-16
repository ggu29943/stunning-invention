#!/usr/bin/env bash
# Assemble the files the game needs at runtime into a folder (default: _site)
# for static hosting. The full-resolution source art (assets/source) and the
# sprite tools are deliberately left out.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
rm -rf "$OUT"
mkdir -p "$OUT/assets/sprites" "$OUT/assets/icons"
cp index.html style.css manifest.webmanifest "$OUT/"
cp -r src "$OUT/"
# one folder per skin (see SKINS in src/assets.js)
cp -r assets/sprites/hd assets/sprites/stockings "$OUT/assets/sprites/"
cp assets/icons/*.png "$OUT/assets/icons/"
# cache busting: every deploy gets its own tag on the script, the stylesheet,
# each module import and (via assets.js) every sprite, so a browser never runs
# a fresh page with stale cached files
VER="$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
sed -i "s#src=\"src/main.js\"#src=\"src/main.js?v=$VER\"#; s#href=\"style.css\"#href=\"style.css?v=$VER\"#" "$OUT/index.html"
sed -i "s#from '\./\([A-Za-z0-9_]*\)\.js'#from './\1.js?v=$VER'#g" "$OUT"/src/*.js
grep -q "main.js?v=$VER" "$OUT/index.html" || { echo "cache tag missing in index.html" >&2; exit 1; }
# every file the page references must be present
for f in index.html style.css manifest.webmanifest src/main.js assets/sprites/hd/sprites.json assets/sprites/stockings/sprites.json assets/sprites/stockings/lift_1.webp assets/icons/icon-192.png; do
  test -s "$OUT/$f" || { echo "missing $f" >&2; exit 1; }
done
echo "site built in $OUT ($(du -sh "$OUT" | cut -f1))"
