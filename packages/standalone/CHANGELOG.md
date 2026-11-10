# Changelog

All notable changes to `@open-ocpp-trace/viewer-standalone` are documented in
this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-10

First release of the Open OCPP Trace viewer for pages that do not use React.

### Added

- One self-contained ES module, `dist/index.js`: the `<TraceViewer>` of
  `@open-ocpp-trace/viewer-react` with its own bundled React copy, so the
  host installs neither `react` nor `react-dom`. It has no chunks, no CSS
  file and no run-time URL, assigns no global variable, and touches no DOM
  until `mount` is called. `dist/index.d.ts` declares every type the API
  uses and needs no React types.
- `mount(element, options?)`, which renders the viewer synchronously in a
  shadow root and returns a `ViewerInstance`: `ingest` adds entries,
  `update` applies untrusted update batches, `setOptions` changes the live
  options, and `unmount` removes the viewer and stops the adapter. Several
  viewers can share a page, each with its own store, correlator and theme.
- Mount-only options: an initial `entries` snapshot, an `adapter`
  (viewer-core `ViewerAdapter`), the store limits `maxEntries` and
  `maxBytes`, the `correlation` scope (or `false`), and a CSP `nonce`. Live
  options mirror the `<TraceViewer>` props (filter, selection, inspector,
  export, `redactExport`, theme, strings, toolbar actions). `mount` and
  `setOptions` throw a `TypeError` for an unknown key or a mount-only key
  given live, and `mount` for options that are not an object.
- `getStats()` on the viewer instance, a snapshot of the store counters
  (evicted entries, entries dropped while paused, ignored updates).
- Style isolation: the stylesheet is applied inside each shadow root, as a
  constructable stylesheet where supported, so page rules and viewer rules
  never mix; `--oot-*` tokens set on an ancestor still theme the viewer.
- CSP support: no `eval` or `new Function`, so `script-src 'self'` is
  enough; the `nonce` option covers the `<style>` fallback.
- Error reporting: the `onError` option receives the errors of host
  callbacks and of the viewer's own store, correlator and filter engine;
  the viewer keeps running.
- `VIEWER_STANDALONE_VERSION`, the version of this package, and
  `bundledReactVersion()`, the version of the bundled React copy.
- `THIRD_PARTY_NOTICES.md`, the versions, licenses and license texts of
  the packages bundled into `dist/index.js`.

[unreleased]: https://github.com/open-ocpp-trace/viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/open-ocpp-trace/viewer/releases/tag/v0.1.0
