#!/usr/bin/env bash
# Compile the TypeScript sources and build Chrome and Firefox packages.
# Run from the repo root. Outputs unpacked folders in dist/ plus release ZIPs.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
COMPILED_ROOT="$ROOT/.build"
DIST_ROOT="$ROOT/dist"

rm -rf "$COMPILED_ROOT"
npm run compile

build() {
  local target="$1"      # chrome | firefox
  local manifest="$2"    # path to manifest file to use
  local out="ads-art-${target}-v${VERSION}.zip"
  local stage="$DIST_ROOT/$target"

  rm -rf "$stage"
  rm -f "$out"
  mkdir -p "$stage/background" "$stage/content" "$stage/popup"

  cp "$manifest" "$stage/manifest.json"
  cp LICENSE "$stage/"
  cp -R icons styles "$stage/"
  cp "$COMPILED_ROOT/background/service-worker.js" "$stage/background/"
  cp "$COMPILED_ROOT/content/"*.js "$stage/content/"
  cp popup/popup.html popup/popup.css "$stage/popup/"
  cp "$COMPILED_ROOT/popup/popup.js" "$stage/popup/"
  find "$stage" -name .DS_Store -delete

  (cd "$stage" && zip -qr "$ROOT/$out" .)
  echo "built dist/$target and $out ($(du -h "$out" | cut -f1))"
}

build chrome manifest.json
build firefox manifest.firefox.json
