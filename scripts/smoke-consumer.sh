#!/bin/sh
# Clean-consumer smoke test of the packed packages.
#
# Builds every package, packs viewer-core, viewer-react and
# viewer-standalone with `bun pm pack` (which replaces `workspace:*` with
# the real version) and checks every tarball with publint --strict and
# attw --profile esm-only (the packages are ESM only, so CommonJS
# resolutions are not required). Then, for React 18 and React 19, installs
# the three tarballs with npm into a throwaway project outside the
# workspace, next to that React version and its @types packages, and:
#   1. imports viewer-core under Node.js and under Bun (no React, no DOM);
#   2. imports viewer-react, checks that it uses the consumer's React and
#      that the project holds a single React copy, and renders a
#      <TraceViewer> and an <EntryInspector> to strings with
#      react-dom/server;
#   3. type-checks smoke-consumer/consumer.ts with `tsc --noEmit`, once
#      with `moduleResolution: "bundler"` and once with "nodenext", so the
#      `types` entry of every tarball must resolve;
# then copies the installed viewer-standalone `dist/` to a directory with
# no node_modules and imports it by file URL with `process` removed, so a
# bare import specifier or a Node.js-only reference left in the asset
# fails.
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
bin="$workspace/node_modules/.bin"
tsc="$workspace/node_modules/typescript/bin/tsc"

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

step "verify the tarballs (publint, attw)"
for tarball in "$tmp"/tarballs/*.tgz; do
  printf '\nsmoke: verify %s\n' "$(basename -- "$tarball")"
  "$bin/publint" --strict "$tarball"
  # viewer-react's `./styles.css` export is a stylesheet, which has no
  # type declarations for attw to find.
  "$bin/attw" "$tarball" --profile esm-only --format ascii \
    --exclude-entrypoints ./styles.css
done

for react_version in $react_versions; do
  major=${react_version%%.*}
  consumer="$tmp/consumer-react-$major"
  # The viewer-react declarations reference React's types: a TypeScript
  # consumer installs the @types packages of its React major.
  case $major in
    18) types_react="@types/react@18.3.31" types_react_dom="@types/react-dom@18.3.7" ;;
    19) types_react="@types/react@19.3.0" types_react_dom="@types/react-dom@19.3.0" ;;
    *) echo "smoke: no @types versions for React $major" >&2; exit 1 ;;
  esac

  step "install the tarballs with React $react_version into a project outside the workspace"
  mkdir "$consumer"
  cp "$fixtures/core.mjs" "$fixtures/react.mjs" "$fixtures/consumer.ts" \
    "$fixtures"/tsconfig.*.json "$consumer/"
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
    "react@$react_version" "react-dom@$react_version" "$types_react" "$types_react_dom" \
    "$tmp"/tarballs/open-ocpp-trace-viewer-core-*.tgz \
    "$tmp"/tarballs/open-ocpp-trace-viewer-react-*.tgz \
    "$tmp"/tarballs/open-ocpp-trace-viewer-standalone-*.tgz)

  step "import viewer-core under Node.js and Bun (React $major consumer)"
  (cd "$consumer" && node core.mjs)
  (cd "$consumer" && bun --no-install core.mjs)

  step "import viewer-react and render a viewer with React $react_version"
  (cd "$consumer" && node react.mjs "$major")
  copies=$(cd "$consumer" && find . -path '*/node_modules/react/package.json' | wc -l | tr -d ' ')
  if [ "$copies" != 1 ]; then
    echo "smoke: expected one React copy in the consumer, found $copies" >&2
    exit 1
  fi
  echo "smoke: one React copy"

  for resolution in bundler nodenext; do
    step "type-check a TypeScript consumer (React $major, moduleResolution: $resolution)"
    (cd "$consumer" && node "$tsc" --project "tsconfig.$resolution.json")
  done
done

step "load the viewer-standalone asset without bare specifiers or Node.js globals"
asset="$tmp/standalone-asset"
cp -R "$tmp/consumer-react-19/node_modules/@open-ocpp-trace/viewer-standalone/dist" "$asset"
node "$fixtures/standalone.mjs" "$asset/index.js"

step "passed"
