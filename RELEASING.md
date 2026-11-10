# Releasing

The three packages of this workspace, `@open-ocpp-trace/viewer-core`,
`@open-ocpp-trace/viewer-react` and `@open-ocpp-trace/viewer-standalone`,
are released together, at one shared version, by the manually started
workflow [`.github/workflows/release.yml`](.github/workflows/release.yml).
It is never triggered by a push or a tag. The CI workflow
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) builds, packs and
smoke-tests the packages on pull requests that touch code and on every push to `main`, but
never publishes anything.

The process is modeled on the
[SDK's](https://github.com/open-ocpp-trace/sdk/blob/main/typescript/RELEASING.md).

## Registry

The packages are published to the npm registry of
[GitHub Packages](https://github.com/orgs/open-ocpp-trace/packages),
`https://npm.pkg.github.com`, like the SDK packages they depend on, and
not to npmjs.com. The committed [`.npmrc`](.npmrc) maps the whole
`@open-ocpp-trace` scope there, and each package sets
`publishConfig.registry` to it. Installing from it needs a GitHub token
with `read:packages`, even for a public package.

## Versioning

- The packages are released in lockstep: one
  [Semantic Versioning](https://semver.org/) version, set in the
  `package.json` of every package and in its `VIEWER_*_VERSION` constant
  (`VIEWER_CORE_VERSION`, `VIEWER_REACT_VERSION`,
  `VIEWER_STANDALONE_VERSION`, in each `src/index.ts`). Every release
  publishes all three. `bun pm pack` replaces `workspace:*` with the exact
  version of the sibling package, so `viewer-react` pins `viewer-core`; a
  shared version keeps them consistent and tells users which versions go
  together.
- The `index.test.ts` of each package checks that its constant equals its
  `package.json` version, and the workflow refuses a release whose
  tarballs carry different versions, whose `viewer-react` does not pin
  `viewer-core` to that version, or whose constants differ from it
  (`scripts/release-manifest.ts lockstep`).
- The packages stay at `0.x` until their API is stable. The version
  follows the largest change of any package.
- The viewer version is independent of the SDK version and of the format
  version (`schemaVersion`, owned by the
  [specification](https://github.com/open-ocpp-trace/specification)). The
  SDK dependencies are pinned to exact published versions.
- A breaking change is marked in its commit (`!` and `BREAKING CHANGE:`)
  and stated first in the release notes.

## Changelog

Each package has a `CHANGELOG.md` following
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), with an
`## [Unreleased]` section at the top that the pull requests fill in. The
release pull request moves those entries under a new
`## [x.y.z] - YYYY-MM-DD` heading. Every release has a section in all
three changelogs, even for a package that did not change: such a section
says only that the package is released at the new version with the
others. Each package lists its `CHANGELOG.md` in `files`, so the
published tarball carries it, and `scripts/verify-packages.sh` refuses a
tarball without it.

The release notes are those sections, extracted by
`scripts/release-notes.sh <version>`. A real release fails when a
changelog has no `## [<version>]` section with entries; a dry run only
warns.

The changelogs are added by a separate pull request of
[#13](https://github.com/open-ocpp-trace/viewer/issues/13). Until it is
merged, `scripts/release-notes.sh` finds no `CHANGELOG.md`: a dry run
warns and a real run stops.

## Third-party notices

`viewer-standalone` bundles its dependencies into `dist/index.js`, so it
ships their licenses in `packages/standalone/THIRD_PARTY_NOTICES.md`.
`packages/standalone/test/third-party-notices.test.ts` fails when that
file drifts from what the pack bundles: a package added to or removed
from `pack.deps.onlyBundle` in `packages/standalone/vite.config.ts`, or
a bundled package bumped to another version, license or license text.
Update the file by hand, then run the test again.

The file keeps its introduction (what is bundled and why, the SDK and
viewer packages being under the Apache License 2.0) and has one section
per package of `onlyBundle`, in that order:

````markdown
## <package name>

- Version: <version of its package.json>
- License: <license of its package.json>

```text
<its LICENSE file, verbatim, without trailing blank lines>
```
````

Each value comes from the installed copy that the pack bundles, found
the way the test finds it (its `IMPORTED_FROM` table): `react` and
`react-dom` from `packages/standalone`, `scheduler` from `react-dom`,
`@tanstack/react-virtual` and `@open-ocpp-trace/jsonl` from
`packages/react`, `@tanstack/virtual-core` from
`@tanstack/react-virtual`, `@open-ocpp-trace/core` from `packages/core`.
After `bun install`, from the repository root:

```sh
dir() { (cd "$1" && node -p "require('node:path').dirname(require.resolve('$2/package.json'))"); }
react_dom=$(dir packages/standalone react-dom)
react_virtual=$(dir packages/react @tanstack/react-virtual)
for d in "$(dir packages/standalone react)" "$react_dom" \
  "$(dir "$react_dom" scheduler)" "$react_virtual" \
  "$(dir "$react_virtual" @tanstack/virtual-core)" \
  "$(dir packages/core @open-ocpp-trace/core)" \
  "$(dir packages/react @open-ocpp-trace/jsonl)"; do
  node -p "const m = require('$d/package.json'); m.name + ' ' + m.version + ' ' + m.license"
  cat "$d/LICENSE"
done
vp test packages/standalone/test/third-party-notices.test.ts
```

A new bundled package also needs an entry in `IMPORTED_FROM`, naming the
workspace package or the bundled package that depends on it. The test
compares only the `LICENSE` file: when a bundled package also ships a
`NOTICE` file, check by hand what its license asks for before releasing.

## Tags

A release creates one lightweight tag, `v<version>`, for example
`v0.1.0`, on the commit the workflow ran on, then the GitHub release of
that tag, titled `Viewer <version>`, with the release notes. The workflow
creates both after a successful publish; do not create them by hand.

## Prerequisites (once)

These need admin rights on the GitHub organization and repository. Do
them **before the first run of the workflow, dry runs included**: the
first run that names a missing environment creates it unprotected, and
its publish job then runs without approval from any branch.

1. **GitHub environment `github-packages`** (repository Settings →
   Environments): required reviewers (the maintainers) and deployment
   branches restricted to `main`. The publish job of every run, dry runs
   included, waits for a reviewer and, with that branch rule, runs only
   from `main`. On another branch the environment rejects the `publish`
   job, so a dry run there checks `verify` only and the run ends
   failed. Enable
   « Prevent self-review » only when at least two people are required
   reviewers, otherwise the person who starts a run can never approve it.

   The workflow also refuses a real release from another ref than `main`,
   but that check lives in the workflow file itself, so a modified copy on
   a branch can drop it; only the environment rule stops such a run.

2. **Package creation** (organization Settings → Packages): allow members
   to create public packages, so the packages can be made public.
3. **After the first publish of each package**, on its page under
   [the organization's packages](https://github.com/orgs/open-ocpp-trace/packages):
   - check that it is linked to `open-ocpp-trace/viewer` (the `repository`
     field of its `package.json`), or link it;
   - Package settings → « Danger Zone » → « Change visibility » →
     public. A new package starts private. Making it public cannot be
     undone.

## What the workflow verifies

The `verify` job, on the commit the workflow is started on:

1. refuses a real release from another ref than `main`;
2. `bun install --frozen-lockfile`, `vp check`, `vp test`;
3. the clean-consumer smoke test (`scripts/smoke-consumer.sh`): builds,
   packs and verifies the three packages, installs them with npm into
   projects outside the workspace with React 18 and 19, and into a
   React-free project for `viewer-standalone`, and imports, renders and
   type-checks them;
4. packs the three packages with `scripts/pack-release.sh` and checks the
   tarballs with `scripts/verify-packages.sh`: only `package.json`,
   `README.md`, `LICENSE`, `CHANGELOG.md`, `dist/` and, in
   `viewer-standalone`, `THIRD_PARTY_NOTICES.md` are packed, the first
   four are present, every `exports` target
   exists, the development-only `@open-ocpp-trace/viewer-source`
   condition, the `prepublishOnly` guard and `workspace:` dependencies are
   gone, `publint --strict` and `attw --profile esm-only` pass;
5. checks the lockstep with `scripts/release-manifest.ts lockstep` (see
   [Versioning](#versioning));
6. extracts the release notes with `scripts/release-notes.sh` and shows
   them in the run summary (see [Changelog](#changelog));
7. checks that the tag `v<version>` and the three
   `@open-ocpp-trace/viewer-<package>@<version>` do not exist yet (only an
   `E404` from the registry counts as absent) and, for a real release,
   that the version is not `0.0.0`.

The `publish` job publishes **those** tarballs, uploaded as an artifact;
it does not rebuild. It publishes `viewer-core` first, then
`viewer-react`, which depends on it, then `viewer-standalone`, which
depends on neither.

## Permissions

- The workflow token is read-only (`contents: read`) by default. No job
  gets `id-token: write`.
- `verify` gets `packages: read`, to install the SDK packages and query
  the registry.
- Only `publish` gets `packages: write`; it runs in the `github-packages`
  environment and authenticates with the workflow token. No registry
  token is stored in the repository.
- Only `tag` gets `contents: write`, to create the tag through the Git
  references API and the GitHub release. It runs after `publish` and only
  when not a dry run.
- No build cache is used, every action is pinned to a commit SHA, and the
  checkout does not persist its credentials.

## Release the packages

1. Open a release pull request that:
   - sets the same `version` in `packages/core/package.json`,
     `packages/react/package.json` and `packages/standalone/package.json`;
   - sets `VIEWER_CORE_VERSION`, `VIEWER_REACT_VERSION` and
     `VIEWER_STANDALONE_VERSION` in each `src/index.ts` to that version;
   - moves the `Unreleased` entries of the three `CHANGELOG.md` under the
     new `## [x.y.z] - YYYY-MM-DD` heading, dated the day of the release.

   Merge it into `main`.

2. Actions → « Release » → « Run workflow » on `main`, keep **dry-run**
   ticked. Approve the `github-packages` environment when asked. The run
   summary shows the release notes; the publish step runs
   `npm publish --dry-run` on the three tarballs and prints their
   contents, names and versions. No tag or release is created.
3. Run it again with **dry-run** unticked and approve. The workflow
   publishes the three packages with `npm publish <tarball> --registry
   https://npm.pkg.github.com` (npm 11.21.1, Node.js 24), then creates the
   tag `v<version>` and its GitHub release. It passes no `--provenance`:
   GitHub Packages does not document npm provenance.
4. Check the three package pages on GitHub: version, linked repository
   and visibility (see prerequisite 3), and the GitHub release. Then, with
   a token that has `read:packages`:

   ```sh
   npm view @open-ocpp-trace/viewer-react@<version> dependencies --registry=https://npm.pkg.github.com
   ```

   It must show `@open-ocpp-trace/viewer-core` at the same version.

## When a run fails after publishing

Use « Re-run failed jobs » on that run, never « Re-run all jobs » and
never a new run: once a version is published, a new `verify` refuses it.
A re-run reuses the verified tarballs and release notes of the run, so it
works only while its artifacts exist (7 days).

The re-run is safe at every step:

- `publish` checks each package before publishing it and skips, with a
  notice, a version already on the registry. A run that published
  `viewer-core` and failed on `viewer-react` publishes only the rest when
  re-run.
- `tag` skips the tag when it already points at the commit of the run,
  and fails when it points at another commit. It then skips the GitHub
  release when the release of that tag already exists.

## Dry run locally

To check the tarballs and the release notes without the workflow, from
the repository root:

```sh
vp run -r pack
sh scripts/pack-release.sh /tmp/open-ocpp-trace-viewer-release
sh scripts/verify-packages.sh /tmp/open-ocpp-trace-viewer-release/*.tgz
node scripts/release-manifest.ts lockstep /tmp/open-ocpp-trace-viewer-release/*.tgz
sh scripts/release-notes.sh <version>
```
