#!/bin/sh
# Packs workspace packages into the tarballs that are published.
#
# Usage, from the repository root:
#   sh scripts/pack-release.sh <destination> [package...]
# where each package is a directory name under packages/ (default: core
# react standalone). Build the packages first (`vp run -r pack`).
#
# For each package:
#   1. `bun pm pack` in the package rewrites `workspace:*` dependencies to
#      the real version (it ignores `publishConfig`, so it cannot drop the
#      development-only export condition itself);
#   2. the tarball is extracted to a staging directory, where
#      scripts/release-manifest.ts removes the
#      `@open-ocpp-trace/viewer-source` export condition and the
#      `prepublishOnly` guard from the copied package.json, and the
#      repository LICENSE is added;
#   3. `npm pack` repacks the staged directory into <destination>.
# The committed package.json is never modified. Prints the path of every
# tarball written; check them with scripts/verify-packages.sh.

set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <destination> [package...]" >&2
  exit 2
fi

workspace=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
license="$workspace/LICENSE"
mkdir -p -- "$1"
destination=$(CDPATH='' cd -- "$1" && pwd)
shift
[ "$#" -gt 0 ] || set -- core react standalone

staging=$(mktemp -d "${TMPDIR:-/tmp}/open-ocpp-trace-viewer-pack.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT
trap 'exit 1' HUP INT TERM

for package in "$@"; do
  source_dir="$workspace/packages/$package"
  [ -f "$source_dir/package.json" ] || {
    echo "pack-release: no package at packages/$package" >&2
    exit 1
  }
  raw="$staging/$package/raw"
  mkdir -p "$raw"
  (cd "$source_dir" && bun pm pack --destination "$raw" --quiet >/dev/null)
  # The raw directory holds exactly the one tarball just written.
  for tarball in "$raw"/*.tgz; do
    tar -xzf "$tarball" -C "$staging/$package"
  done
  node "$workspace/scripts/release-manifest.ts" strip "$staging/$package/package/package.json"
  cp "$license" "$staging/$package/package/LICENSE"
  name=$(cd "$staging/$package/package" &&
    npm pack --ignore-scripts --silent --pack-destination "$destination")
  echo "$destination/$name"
done
