# Open OCPP Trace Viewer

Embeddable viewer for [Open OCPP Trace](https://github.com/open-ocpp-trace/specification)
records: a framework-neutral core, React components, and a self-contained
bundle for pages that use no build tool. It reads records through the
[SDK](https://github.com/open-ocpp-trace/sdk) and never keeps its own copy of
the schema or the JSONL codec.

Work in progress: see the [v0.1 issues](https://github.com/open-ocpp-trace/viewer/issues).
Nothing is published yet.

## Packages

| Package                              | Directory                                    | Purpose                                                        |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------------- |
| `@open-ocpp-trace/viewer-core`       | [`packages/core`](packages/core)             | Viewer model, no React, DOM, Node.js or Bun API                |
| `@open-ocpp-trace/viewer-react`      | [`packages/react`](packages/react)           | React components; React 18 or 19 is a peer dependency          |
| `@open-ocpp-trace/viewer-standalone` | [`packages/standalone`](packages/standalone) | Self-contained ESM asset that bundles React, for any host page |

The repository also holds a private playground ([`apps/playground`](apps/playground))
and integration examples under [`examples/`](examples).

## Prerequisites

- [Bun](https://bun.sh/) 1.4.4, the version pinned by `packageManager` in
  [`package.json`](package.json). Bun is the package manager of the
  workspace; the packages do not depend on it.
- [Node.js](https://nodejs.org/) 22.18+, 24.11+ or 26+, the range required
  by Vite+ (`engines` in [`package.json`](package.json)).
- The [Vite+](https://viteplus.dev/) command line, `vp`. The workspace pins
  `vite-plus` as a dev dependency, and a globally installed `vp` delegates to
  that local version.
- `npm` on the `PATH`, for the smoke test.

## GitHub Packages authentication

The SDK packages `@open-ocpp-trace/core` and `@open-ocpp-trace/jsonl` are
published to [GitHub Packages](https://github.com/orgs/open-ocpp-trace/packages),
whose npm registry needs a GitHub token with the `read:packages` scope, even
for a public package. The committed [`.npmrc`](.npmrc) maps the scope and
reads the token from the `GITHUB_TOKEN` environment variable:

```ini
@open-ocpp-trace:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

With the [GitHub CLI](https://cli.github.com/) logged in with
`read:packages` (`gh auth refresh --scopes read:packages` adds it):

```sh
export GITHUB_TOKEN=$(gh auth token)
```

A classic personal access token with `read:packages` works too. CI uses the
workflow token with `packages: read`.

## Commands

Run every command from the repository root, with `GITHUB_TOKEN` set.

```sh
bun install --frozen-lockfile   # install the exact versions in bun.lock
vp check                        # format check, lint and type check
vp test                         # run the tests once
vp test packages/core           # run the tests of one package
vp run -r pack                  # build every package into its dist/
vp run smoke                    # smoke-test the packed packages from a clean consumer
vp run @open-ocpp-trace/viewer-playground#dev     # start the playground
vp run @open-ocpp-trace/viewer-playground#build   # build the playground
```

`vp check --fix` applies formatting and safe lint fixes.

`vp run smoke` runs [`scripts/smoke-consumer.sh`](scripts/smoke-consumer.sh).
It builds and packs the three packages, then installs the tarballs with npm
into throwaway projects outside the workspace, one with React 18 and one
with React 19, and:

- imports `viewer-core` under Node.js and Bun;
- checks that `viewer-react` uses the consumer's React and that the project
  holds a single React copy;
- loads the `viewer-standalone` asset by file URL from a directory without
  `node_modules`, so a bare import left in the asset fails.

`SMOKE_KEEP=1` keeps the temporary directory.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the install,
`vp check`, `vp test`, `vp run -r pack` and the playground build on
Node.js 22 and 24, and the smoke test on Node.js 22. It runs when a pull
request touches `packages/`, `apps/`, `examples/`, `scripts/`, the root
configuration, the lockfile or the workflow, and on every push to `main`.

## Layout

```text
├── package.json        private workspace root: tools and scripts only
├── bun.lock
├── .npmrc              @open-ocpp-trace scope → GitHub Packages
├── tsconfig.base.json  shared compiler options
├── vite.config.ts      lint, format and test configuration
├── scripts/            smoke test
├── packages/
│   ├── core/           src/, test/, vite.config.ts (pack configuration)
│   ├── react/          same layout
│   └── standalone/     same layout
├── apps/playground/    private Vite app
└── examples/           simulator, debugkit, gateway
```

Each package exports its sources under the `@open-ocpp-trace/viewer-source`
condition, before `types` and `default`. The type check, the tests and the
playground enable that condition, so a package is checked against the
sources of its siblings without a prior build. Consumers do not set it and
resolve `dist/`.

## Documentation

- [Contributing](CONTRIBUTING.md): checks, tests, commits and pull requests.
- [Releasing](RELEASING.md): versioning conventions.

## License

Apache-2.0, see [LICENSE](LICENSE).
