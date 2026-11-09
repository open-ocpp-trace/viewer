# Releasing

Nothing is released yet: every package is `"private": true` at version
`0.0.0`, and no workflow publishes. The release workflow, the changelogs
and the first published version are the subject of
[#13](https://github.com/open-ocpp-trace/viewer/issues/13). This page sets the
conventions that work follows, modeled on the
[SDK's](https://github.com/open-ocpp-trace/sdk/blob/main/typescript/RELEASING.md).

## Versioning

- Each package follows [Semantic Versioning](https://semver.org/). The
  packages stay at `0.x` until their API is stable; the bump rules within
  `0.x` are set in #13.
- `bun pm pack` replaces `workspace:*` with the exact version of the sibling
  package, so `viewer-react` pins `viewer-core`, as the SDK's `jsonl` pins
  `core`. Whether the three packages share one version, as the SDK packages
  do, is decided in #13.
- The viewer version is independent of the SDK version and of the format
  version (`schemaVersion`, owned by the
  [specification](https://github.com/open-ocpp-trace/specification)). The
  SDK dependencies are pinned to exact published versions.
- A breaking change is marked in its commit (`!` and `BREAKING CHANGE:`)
  and stated first in the release notes.

## Registry

Not decided yet (#13). The committed [`.npmrc`](.npmrc) maps the whole
`@open-ocpp-trace` scope to GitHub Packages to install the SDK, so the viewer
packages would resolve there too unless the mapping is split: publishing to
GitHub Packages like the SDK is the default, npmjs.com would need a
narrower mapping.
