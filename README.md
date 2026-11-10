# Open OCPP Trace Viewer

Embeddable viewer for [Open OCPP Trace](https://github.com/open-ocpp-trace/specification)
records: a framework-neutral core, React components, and a self-contained
bundle for pages that use no build tool. It reads records through the
[SDK](https://github.com/open-ocpp-trace/sdk) and never keeps its own copy of
the schema or the JSONL codec.

The packages are not published yet: the first release is 0.1.0, on
[GitHub Packages](https://github.com/orgs/open-ocpp-trace/packages). The
installation steps below apply from 0.1.0.

## Packages

| Package                              | Directory                                    | Purpose                                                        |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------------- |
| `@open-ocpp-trace/viewer-core`       | [`packages/core`](packages/core)             | Viewer model, no React, DOM, Node.js or Bun API                |
| `@open-ocpp-trace/viewer-react`      | [`packages/react`](packages/react)           | React components; React 18 or 19 is a peer dependency          |
| `@open-ocpp-trace/viewer-standalone` | [`packages/standalone`](packages/standalone) | Self-contained ESM asset that bundles React, for any host page |

### Which package to choose

- **viewer-core**: a headless model, for a host that renders its own UI or
  processes traces without one. It holds the bounded store of entries, the
  correlation of calls and responses, and the filter engine.
- **viewer-react**: for a React 18 or 19 application. It renders the trace
  list, the filter panel and the inspector, or `<TraceViewer>`, which composes
  them. It uses the host's React copy and renders in the host's DOM.
- **viewer-standalone**: for any other page (no framework, another framework,
  server-rendered HTML), and for a React page whose global CSS is aggressive.
  It bundles its own React copy, mounts with a plain function, and renders in
  a shadow root, so page styles do not reach it.

## Installation

### Registry setup

The packages are published to GitHub Packages under the `@open-ocpp-trace`
scope. The SDK packages they depend on, `@open-ocpp-trace/core` and
`@open-ocpp-trace/jsonl`, come from the same scope. Map the scope in the
`.npmrc` of your project:

```ini
@open-ocpp-trace:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

The npm registry of GitHub Packages needs a token even for a public package:
a classic personal access token with the `read:packages` scope, or the token
of a GitHub CLI logged in with that scope
(`gh auth refresh --scopes read:packages`, then
`export GITHUB_TOKEN=$(gh auth token)`). In GitHub Actions, the workflow
token with `packages: read` works. A pipeline that sets `NODE_AUTH_TOKEN`,
such as `actions/setup-node`, writes `${NODE_AUTH_TOKEN}` in the
`_authToken` line instead.

### Install

From 0.1.0, with npm, pnpm or Bun:

```sh
# Headless model
npm install @open-ocpp-trace/viewer-core
pnpm add @open-ocpp-trace/viewer-core
bun add @open-ocpp-trace/viewer-core

# React components; the host imports viewer-core too, to create the store
npm install @open-ocpp-trace/viewer-react @open-ocpp-trace/viewer-core
pnpm add @open-ocpp-trace/viewer-react @open-ocpp-trace/viewer-core
bun add @open-ocpp-trace/viewer-react @open-ocpp-trace/viewer-core

# Standalone bundle: no React or SDK package to install
npm install @open-ocpp-trace/viewer-standalone
pnpm add @open-ocpp-trace/viewer-standalone
bun add @open-ocpp-trace/viewer-standalone
```

`viewer-react` depends on the exact same version of `viewer-core`: keep both
at the same version.

## Integration

### viewer-core

```ts
import {
  createCorrelator,
  createFilterEngine,
  createViewerStore,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

declare const entries: ViewerEntry[]; // traces, unparsed frames and gaps

const store = createViewerStore({ maxEntries: 5_000 });
const correlator = createCorrelator({ scope: "conversation" });
const engine = createFilterEngine({ correlator });
correlator.connect(store);
engine.connect(store);

store.load(entries);
engine.setFilter({ kinds: ["trace"], actions: ["BootNotification"] });
```

The [viewer-core README](packages/core/README.md) covers the store, the
adapters and the filters.

### viewer-react

```tsx
import "@open-ocpp-trace/viewer-react/styles.css";

import type { ReactElement } from "react";
import { createViewerStore } from "@open-ocpp-trace/viewer-core";
import { TraceViewer } from "@open-ocpp-trace/viewer-react";

const store = createViewerStore();

export function Traces(): ReactElement {
  return (
    <div style={{ height: 480 }}>
      <TraceViewer store={store} theme={{ colorScheme: "dark" }} />
    </div>
  );
}
```

The [viewer-react README](packages/react/README.md) covers the props,
theming, localization, slots and the redacted export.

### viewer-standalone

```js
import { mount } from "@open-ocpp-trace/viewer-standalone";

const viewer = mount(document.getElementById("trace"), { entries });
viewer.ingest(moreEntries);
viewer.setOptions({ theme: { colorScheme: "dark" } });
viewer.unmount();
```

Without a bundler, serve `dist/index.js` and import it by its URL. The
[viewer-standalone README](packages/standalone/README.md) covers the options,
the lifecycle, styling and CSP, and [`examples/standalone`](examples/standalone)
is a complete page.

## Supported versions

| Dependency      | Supported                                                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | ES modules only (ES2022). The packages declare no `engines`; the smoke test imports viewer-core under Node.js 22 and Bun, and CI tests on Node.js 22 and 24.    |
| React           | `react` and `react-dom` `^18.0.0 \|\| ^19.0.0`, peer dependencies of viewer-react. viewer-standalone bundles its own copy (`bundledReactVersion()`).            |
| SDK             | `@open-ocpp-trace/core` and `@open-ocpp-trace/jsonl` 0.1.0, pinned exactly.                                                                                     |
| Open OCPP Trace | Format 1.x, as the SDK 0.1.0 reads it: any `schemaVersion` `"1.<minor>"`; it writes `"1.1"`. The viewer does not check the version: it receives parsed records. |

## Known limitations

- **Host base styles in viewer-react.** viewer-react renders in the host's
  DOM. Its controls (inputs, checkboxes, buttons, fieldsets) keep their look
  under global resets such as Tailwind preflight or form plugins, but its
  other elements do not: the viewer inherits the host's `line-height`, and a
  reset of elements such as `dd` or `pre` can make the inspector and the row
  cells look cramped. For a host with aggressive base styles, use
  viewer-standalone, whose shadow root keeps page styles out.
- **Standalone store limits are fixed at mount.** `maxEntries`, `maxBytes`,
  `correlation`, `adapter`, `entries` and `nonce` are mount-only options:
  `setOptions` throws a `TypeError` for them. Unmount and mount again to
  change them.
- **Payload search is opt-in.** The text search reads metadata only, unless
  the filter engine is created with `payloadSearch: true` (the
  `payloadSearch` prop of `<TraceViewer>`, or the live option of
  viewer-standalone). Only then does it read payloads, raw frames and error
  details.
- **Redacted export.** Exports are faithful by default; `redactExport`
  replaces the value of each sensitive key with `"[redacted]"`. It drops the
  `raw` frame of a record when the frame holds a sensitive key or cannot be
  checked (SOAP, not JSON, or over 1 000 000 characters). Matching is by
  property name only: a secret carried as a value, such as the value of a
  `BasicAuthPassword` variable, is not detected.
- **Correlation scope** ([ADR 0002](docs/adr/0002-correlation-scope.md)).
  Calls and responses are paired within a scope: `conversation` (charge point
  and session, the default), `chargePoint` or `global`. `tenant` and
  `conversationId` are not part of any key. The key is computed when an entry
  is first listed, so metadata that arrives later does not re-correlate it;
  reload the stream or change the scope to apply it. An ambiguous match is
  listed with its candidates, never claimed, and a response whose CALL was
  evicted from the bounded store shows as an orphan.

## Development

The repository also holds a private playground ([`apps/playground`](apps/playground))
and integration examples under [`examples/`](examples).

### Prerequisites

- [Bun](https://bun.sh/) 1.4.4, the version pinned by `packageManager` in
  [`package.json`](package.json). Bun is the package manager of the
  workspace; the packages do not depend on it.
- [Node.js](https://nodejs.org/) 22.18+, 24.11+ or 26+, the range required
  by Vite+ (`engines` in [`package.json`](package.json)).
- The [Vite+](https://viteplus.dev/) command line, `vp`. The workspace pins
  `vite-plus` as a dev dependency, and a globally installed `vp` delegates to
  that local version.
- `npm` on the `PATH`, for the smoke test.

### GitHub Packages authentication

The workspace installs the SDK from GitHub Packages. The committed
[`.npmrc`](.npmrc) maps the scope as in [Registry setup](#registry-setup)
and reads the token from `GITHUB_TOKEN`:

```sh
export GITHUB_TOKEN=$(gh auth token)   # a token with read:packages
```

CI uses the workflow token with `packages: read`.

### Commands

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
It builds and packs the three packages, checks each tarball with
`publint --strict` and `attw --profile esm-only`, then installs the tarballs
with npm into throwaway projects outside the workspace, one with React 18
and one with React 19, and:

- imports `viewer-core` under Node.js and Bun;
- checks that `viewer-react` uses the consumer's React and that the project
  holds a single React copy;
- type-checks a TypeScript consumer of the three packages with
  `tsc --noEmit`, under the `bundler` and `nodenext` module resolutions;
- loads the `viewer-standalone` asset by file URL from a directory without
  `node_modules`, with `process` removed from the global scope, so a bare
  import or a Node.js-only reference left in the asset fails.

`SMOKE_KEEP=1` keeps the temporary directory.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs the install,
`vp check`, `vp test`, `vp run -r pack` and the playground build on
Node.js 22 and 24, and the smoke test on Node.js 22. It runs when a pull
request touches `packages/`, `apps/`, `examples/`, `scripts/`, the root
configuration, the lockfile or the workflow, and on every push to `main`.

### Layout

```text
├── package.json        private workspace root: tools and scripts only
├── bun.lock
├── .npmrc              @open-ocpp-trace scope → GitHub Packages
├── tsconfig.base.json  shared compiler options
├── vite.config.ts      lint, format and test configuration
├── scripts/            smoke test, release packing and checks
├── packages/
│   ├── core/           src/, test/, vite.config.ts (pack configuration)
│   ├── react/          same layout
│   └── standalone/     same layout
├── apps/playground/    private Vite app
└── examples/           standalone page; simulator, debugkit, gateway placeholders
```

[`examples/standalone`](examples/standalone) is a working page. The
simulator, DebugKit and gateway examples are deferred work, tracked in
[#10](https://github.com/open-ocpp-trace/viewer/issues/10),
[#11](https://github.com/open-ocpp-trace/viewer/issues/11) and
[#12](https://github.com/open-ocpp-trace/viewer/issues/12); they do not gate
the 0.1.0 release.

Each package exports its sources under the `@open-ocpp-trace/viewer-source`
condition, before `types` and `default`. The type check, the tests and the
playground enable that condition, so a package is checked against the
sources of its siblings without a prior build. Consumers do not set it and
resolve `dist/`.

## Documentation

- [Contributing](CONTRIBUTING.md): checks, tests, commits and pull requests.
- [Releasing](RELEASING.md): versioning, prerequisites and the release workflow.
- Changelogs: [viewer-core](packages/core/CHANGELOG.md),
  [viewer-react](packages/react/CHANGELOG.md),
  [viewer-standalone](packages/standalone/CHANGELOG.md).
- Design decisions: [`docs/adr/`](docs/adr).

## License

Apache-2.0, see [LICENSE](LICENSE).
