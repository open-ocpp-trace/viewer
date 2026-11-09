#!/bin/sh
# Clean-consumer smoke test of the packed packages.
#
# Builds every package, packs viewer-core, viewer-react and
# viewer-standalone with `bun pm pack` (which replaces `workspace:*` with
# the real version), then, for React 18 and React 19, installs the three
# tarballs with npm into a throwaway project outside the workspace, next
# to that React version, and:
#   1. imports viewer-core under Node.js and under Bun (no React, no DOM);
#   2. imports viewer-react and checks that it uses the consumer's React
#      and that the project holds a single React copy;
# then copies the installed viewer-standalone `dist/` to a directory with
# no node_modules and imports it by file URL, so a bare import specifier
# left in the asset fails.
# No custom export condition is set, so the packages resolve to `dist/`
# exactly as for a published install.
#
# The SDK dependencies (@open-ocpp-trace/core, @open-ocpp-trace/jsonl)
# come from GitHub Packages: the repository .npmrc is copied into the
# consumer and GITHUB_TOKEN must hold a token with `read:packages`.
#
# Run from the repository root: `vp run smoke`. Set SMOKE_KEEP=1 to keep
# the temporary directory for inspection. Exits non-zero on the first
# failure.

set -eu

workspace=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
fixtures="$workspace/scripts/smoke-consumer"

# Exact versions, so a run is reproducible; the majors are the peer range
# of viewer-react.
react_versions="18.3.1 19.3.1"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "smoke: GITHUB_TOKEN is not set; it needs read:packages to install the SDK packages" >&2
  echo "smoke: export GITHUB_TOKEN=\$(gh auth token)" >&2
  exit 1
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/open-ocpp-trace-viewer-smoke.XXXXXX")
cleanup() {
  if [ "${SMOKE_KEEP:-}" = 1 ]; then
    echo "smoke: kept $tmp"
  else
    rm -rf -- "$tmp"
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

step() {
  printf '\nsmoke: %s\n' "$1"
}

step "build every package"
(cd "$workspace" && vp run -r pack)

step "pack the packages"
mkdir "$tmp/tarballs"
for package in core react standalone; do
  (cd "$workspace/packages/$package" && bun pm pack --destination "$tmp/tarballs" --quiet >/dev/null)
done
ls "$tmp/tarballs"

for react_version in $react_versions; do
  major=${react_version%%.*}
  consumer="$tmp/consumer-react-$major"

  step "install the tarballs with React $react_version into a project outside the workspace"
  mkdir "$consumer"
  cp "$fixtures/core.mjs" "$fixtures/react.mjs" "$consumer/"
  cp "$workspace/.npmrc" "$consumer/.npmrc"
  cat > "$consumer/package.json" <<'EOF'
{
  "name": "open-ocpp-trace-viewer-smoke-consumer",
  "private": true,
  "type": "module"
}
EOF
  # One install for every tarball: viewer-react depends on the exact
  # viewer-core version, which only the local tarball provides.
  (cd "$consumer" && npm install --no-audit --no-fund --ignore-scripts \
    "react@$react_version" "react-dom@$react_version" \
    "$tmp"/tarballs/open-ocpp-trace-viewer-core-*.tgz \
    "$tmp"/tarballs/open-ocpp-trace-viewer-react-*.tgz \
    "$tmp"/tarballs/open-ocpp-trace-viewer-standalone-*.tgz)

  step "import viewer-core under Node.js and Bun (React $major consumer)"
  (cd "$consumer" && node core.mjs)
  (cd "$consumer" && bun --no-install core.mjs)

  step "import viewer-react with React $react_version"
  (cd "$consumer" && node react.mjs "$major")
  copies=$(cd "$consumer" && find . -path '*/node_modules/react/package.json' | wc -l | tr -d ' ')
  if [ "$copies" != 1 ]; then
    echo "smoke: expected one React copy in the consumer, found $copies" >&2
    exit 1
  fi
  echo "smoke: one React copy"
done

step "load the viewer-standalone asset without bare specifiers"
asset="$tmp/standalone-asset"
cp -R "$tmp/consumer-react-19/node_modules/@open-ocpp-trace/viewer-standalone/dist" "$asset"
node "$fixtures/standalone.mjs" "$asset/index.js"

step "passed"
