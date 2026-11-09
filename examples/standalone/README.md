# Standalone viewer example

A plain HTML and TypeScript page that mounts two viewers from the built
`@open-ocpp-trace/viewer-standalone` asset. The page has no React in its
dependencies: the asset bundles its own copy. Nothing runs besides the page:
the trace is an in-memory sample, with no network, SSE endpoint or gateway.

The page shows:

- two viewers side by side, each in its own shadow root, with different
  themes and strings (the right one in French);
- the left viewer fed by a snapshot at `mount`, then `ingest()` and
  `update()`; the right one fed by an in-memory `ViewerAdapter`;
- "Add a heartbeat" and "Tag the boot entry", which add an entry and apply a
  metadata update to both viewers;
- the `onSelectionChange` and `onFilterChange` callbacks, logged in the
  page's own markup;
- "Unmount" / "Mount", which tears both viewers down (the adapter is
  unsubscribed) and mounts them again;
- `setOptions()`, through the dark-theme checkbox of the left viewer.

## Run it

From the repository root, after `bun install`:

```sh
vp run -r pack                                            # builds packages/standalone/dist
vp run @open-ocpp-trace/viewer-example-standalone#build   # or #dev for a dev server
```

The Vite config resolves only the conditions of a published install, so the
page imports `packages/standalone/dist/index.js`, never the package sources:
the build fails until the package is packed. Rebuild the package after
changing it. The editor and `vp check` read the types from the sources, which
declare the same API.

`src/main.ts` is the whole integration; `src/sample.ts` holds the sample
entries and the in-memory adapter.
