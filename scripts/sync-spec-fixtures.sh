#!/usr/bin/env bash
# Vendors the conformance fixtures of the Open OCPP Trace specification.
#
# Usage: scripts/sync-spec-fixtures.sh <commit-sha>
#
# Fetches the specification repository at that commit (a full 40-hex sha,
# nothing else), replaces packages/core/test/fixtures/spec/ with every
# fixtures/<name>/{trace.jsonl,expected.json} and the specification's
# LICENSE, and writes the attribution README there. Set SPEC_REPO to a
# path or URL to fetch from another clone than the GitHub repository.
set -euo pipefail

readonly DEFAULT_REPO="https://github.com/open-ocpp-trace/specification"

if [[ $# -ne 1 || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: $0 <commit-sha> (a full 40-hex lowercase commit sha)" >&2
  exit 2
fi
sha=$1
repo=${SPEC_REPO:-$DEFAULT_REPO}
root=$(cd "$(dirname "$0")/.." && pwd)
dest="$root/packages/core/test/fixtures/spec"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

git -C "$work" init -q
git -C "$work" fetch -q --depth 1 "$repo" "$sha"
git -C "$work" checkout -q --detach FETCH_HEAD
fetched=$(git -C "$work" rev-parse HEAD)
if [[ $fetched != "$sha" ]]; then
  echo "fetched $fetched instead of $sha" >&2
  exit 1
fi

shopt -s nullglob
fixtures=("$work"/fixtures/*/)
if [[ ${#fixtures[@]} -eq 0 ]]; then
  echo "no fixtures found in $repo at $sha" >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"
for dir in "${fixtures[@]}"; do
  name=$(basename "$dir")
  for file in trace.jsonl expected.json; do
    if [[ ! -f $dir$file ]]; then
      echo "fixture $name has no $file" >&2
      exit 1
    fi
  done
  mkdir "$dest/$name"
  cp "${dir}trace.jsonl" "${dir}expected.json" "$dest/$name/"
done
cp "$work/LICENSE" "$dest/LICENSE"

cat >"$dest/README.md" <<EOF
# Open OCPP Trace specification fixtures

Do not edit these files. They are a verbatim copy of the conformance
fixtures of the Open OCPP Trace specification, refreshed by running:

    scripts/sync-spec-fixtures.sh <commit-sha>

- Source: $DEFAULT_REPO
- Commit: $sha
- Copied: \`fixtures/*/trace.jsonl\`, \`fixtures/*/expected.json\` and
  \`LICENSE\`.

The fixtures are licensed under the Apache License, Version 2.0, by the
authors of the Open OCPP Trace specification; see \`LICENSE\` in this
folder. They are used unmodified.
EOF

echo "vendored ${#fixtures[@]} fixtures from $repo at $sha into ${dest#"$root"/}"
