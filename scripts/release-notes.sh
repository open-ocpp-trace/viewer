#!/bin/sh
# Prints the release notes of a lockstep viewer release.
#
# Usage, from the repository root:
#   sh scripts/release-notes.sh <version> [package...]
# where each package is a directory name under packages/ (default: core
# react standalone).
#
# For each package, prints a `## <package name>` heading followed by the
# body of the `## [<version>]` section of its CHANGELOG.md: the lines after
# that heading, up to the next `## ` heading or the reference link
# definitions at the bottom, without trailing blank lines. Exits non-zero
# if a package has no such section or the section is empty.

set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <version> [package...]" >&2
  exit 2
fi

workspace=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
version=$1
shift
[ "$#" -gt 0 ] || set -- core react standalone

separator=
for package in "$@"; do
  changelog="$workspace/packages/$package/CHANGELOG.md"
  [ -f "$changelog" ] || {
    echo "release-notes: no CHANGELOG.md in packages/$package" >&2
    exit 1
  }
  # The headings and link definitions are compared literally, so the dots
  # of the version are not wildcards and no bracket expression depends on
  # the awk dialect of the runner.
  body=$(awk -v heading="## [$version]" '
    function is_heading(line) {
      return index(line, heading) == 1 &&
        (length(line) == length(heading) || substr(line, length(heading) + 1, 1) == " ")
    }
    function is_link_definition(line) {
      return substr(line, 1, 1) == "[" && index(line, "]: ") > 0
    }
    in_section && (substr($0, 1, 3) == "## " || is_link_definition($0)) { exit }
    in_section { print }
    is_heading($0) { in_section = 1 }
  ' "$changelog")
  # $(...) drops the trailing newlines; a body of blank lines only is empty.
  if [ -z "$(printf '%s' "$body" | tr -d ' \n')" ]; then
    echo "release-notes: packages/$package/CHANGELOG.md has no entries under ## [$version] (section missing or empty)" >&2
    exit 1
  fi
  printf '%s## @open-ocpp-trace/viewer-%s\n%s\n' "$separator" "$package" "$body"
  separator='
'
done
