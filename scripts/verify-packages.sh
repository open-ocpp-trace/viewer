#!/bin/sh
# Checks packed tarballs before they are installed or published.
#
# Usage, from the repository root: sh scripts/verify-packages.sh <tarball>...
#
# For each tarball:
#   1. scripts/release-manifest.ts inspect: only package.json, README.md,
#      LICENSE, THIRD_PARTY_NOTICES.md and dist/ are packed, LICENSE and
#      README.md are present (and THIRD_PARTY_NOTICES.md in
#      viewer-standalone, which bundles third-party code),
#      every `exports` target exists in the tarball, the development-only
#      `@open-ocpp-trace/viewer-source` condition is gone and no
#      dependency is still `workspace:`;
#   2. publint --strict: package.json fields and export paths;
#   3. attw --profile esm-only: TypeScript resolves the types of every
#      entry point under the node16 (ESM) and bundler resolutions. The
#      packages are ESM only, so CommonJS resolutions are not required.
#      viewer-react's `./styles.css` export is a stylesheet, which has no
#      type declarations for attw to find, so it is excluded.
# Runs every check on every tarball, then exits non-zero if any failed.

set -u

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <tarball>..." >&2
  exit 2
fi

workspace=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
bin="$workspace/node_modules/.bin"
status=0

for tarball in "$@"; do
  printf '\nverify: %s\n' "$tarball"
  node "$workspace/scripts/release-manifest.ts" inspect "$tarball" || status=1
  "$bin/publint" --strict "$tarball" || status=1
  "$bin/attw" "$tarball" --profile esm-only --format ascii \
    --exclude-entrypoints ./styles.css || status=1
done

if [ "$status" -ne 0 ]; then
  printf '\nverify: FAILED\n' >&2
else
  printf '\nverify: passed\n'
fi
exit "$status"
