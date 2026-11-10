#!/bin/sh
# Clean-consumer smoke test of the packed packages.
#
# Builds every package, packs viewer-core, viewer-react and
# viewer-standalone with scripts/pack-release.sh (the tarballs the release
# publishes: `workspace:*` pinned, the development-only export condition
# stripped, LICENSE added) and checks them with scripts/verify-packages.sh
# (contents, publint, attw). Then, for React 18 and React 19, installs
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
# then installs the viewer-standalone tarball alone into a React-free
# project and:
#   4. checks that neither React, its types, viewer-react nor viewer-core
#      was installed with it;
#   5. type-checks smoke-consumer/standalone/consumer.ts with `tsc
#      --noEmit` and `skipLibCheck: false`, with "bundler" and "nodenext",
#      so `dist/index.d.ts` must stand without React types;
#   6. copies its `dist/` to a directory with no node_modules, checks that
#      the asset calls neither `eval` nor the `Function` constructor, and
#      imports it by file URL with `process` removed, so a bare import
#      specifier or a Node.js-only reference left in the asset fails;
#   7. mounts two viewers from that copy into a happy-dom page (happy-dom
#      from the workspace, not the consumer), checks that each renders in
#      its own shadow root, then unmounts both and checks that the host
#      elements are back as they were and that no global was added.
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

# new_consumer <dir> <package name>: creates a throwaway ESM project that
# installs from the same registries as the workspace.
new_consumer() {
  mkdir "$1"
  cp "$workspace/.npmrc" "$1/.npmrc"
  cat > "$1/package.json" <<EOF
{
  "name": "$2",
  "private": true,
  "type": "module"
}
EOF
}

# npm_install <dir> <spec>...: installs the specs into that project.
npm_install() {
  dir=$1
  shift
  (cd "$dir" && npm install --no-audit --no-fund --ignore-scripts "$@")
}

step "build every package"
(cd "$workspace" && vp run -r pack)

step "pack the packages as published"
sh "$workspace/scripts/pack-release.sh" "$tmp/tarballs" core react standalone

step "verify the tarballs"
sh "$workspace/scripts/verify-packages.sh" "$tmp"/tarballs/*.tgz

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
  new_consumer "$consumer" open-ocpp-trace-viewer-smoke-consumer
  cp "$fixtures/core.mjs" "$fixtures/react.mjs" "$fixtures/consumer.ts" \
    "$fixtures"/tsconfig.*.json "$consumer/"
  # One install for every tarball: viewer-react depends on the exact
  # viewer-core version, which only the local tarball provides.
  npm_install "$consumer" \
    "react@$react_version" "react-dom@$react_version" "$types_react" "$types_react_dom" \
    "$tmp"/tarballs/open-ocpp-trace-viewer-core-*.tgz \
    "$tmp"/tarballs/open-ocpp-trace-viewer-react-*.tgz \
    "$tmp"/tarballs/open-ocpp-trace-viewer-standalone-*.tgz

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

consumer="$tmp/consumer-standalone"
step "install only the viewer-standalone tarball into a React-free project"
new_consumer "$consumer" open-ocpp-trace-viewer-smoke-standalone
cp "$fixtures/standalone/consumer.ts" "$fixtures"/standalone/tsconfig.*.json "$consumer/"
# The standalone configs extend the base pair one directory up, as in
# the repository.
cp "$fixtures"/tsconfig.*.json "$tmp/"
npm_install "$consumer" "$tmp"/tarballs/open-ocpp-trace-viewer-standalone-*.tgz
for absent in react react-dom @types/react @types/react-dom \
  @open-ocpp-trace/viewer-react @open-ocpp-trace/viewer-core; do
  if [ -e "$consumer/node_modules/$absent" ]; then
    echo "smoke: the viewer-standalone install pulled $absent" >&2
    exit 1
  fi
done
echo "smoke: no React, React types, viewer-react or viewer-core installed"

for resolution in bundler nodenext; do
  step "type-check the React-free consumer (moduleResolution: $resolution)"
  (cd "$consumer" && node "$tsc" --project "tsconfig.$resolution.json")
done

step "load the viewer-standalone asset without bare specifiers, Node.js globals or eval"
asset="$tmp/standalone-asset"
cp -R "$consumer/node_modules/@open-ocpp-trace/viewer-standalone/dist" "$asset"
node "$fixtures/standalone.mjs" "$asset/index.js"

step "mount, render and unmount two standalone viewers in a happy-dom page"
node "$fixtures/standalone/dom.mjs" "$asset/index.js" "$workspace/node_modules/happy-dom"

step "passed"
