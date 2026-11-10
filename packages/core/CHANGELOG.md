# Changelog

All notable changes to `@open-ocpp-trace/viewer-core` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-10

First release of the framework-neutral model of the Open OCPP Trace viewer.
It has no DOM or React dependency.

### Added

- Viewer entry contract: `ViewerEntry` is a parsed `TraceEntry` (an Open
  OCPP Trace record typed by `@open-ocpp-trace/core`), an `UnparsedEntry`
  for a frame that could not be parsed, or a `GapEntry` for traffic the
  producer missed, with optional `EntryMetadata` (charge point, tenant,
  session, conversation, source, deliveries, custom fields).
- `ViewerAdapter` (`snapshot()` and `subscribe(listener)`), the one hook
  through which a producer feeds the viewer; transports and codecs stay in
  the adapter.
- `createViewerStore`, a bounded, ordered store of entries: `load`,
  `apply` (`add` and metadata `update` batches with revisions), `pause` and
  `resume`, `clear`, and `connect(adapter)`, which applies the snapshot and
  replays what arrived meanwhile without loss or duplicates. The oldest
  entries are evicted past `maxEntries` or `maxBytes`
  (`DEFAULT_MAX_ENTRIES`, `DEFAULT_MAX_BYTES`); entries dropped while
  paused are listed as a gap on `resume`. `getStats()` returns its
  counters: evicted and dropped entries, ignored duplicate, unknown, stale
  and invalid updates.
- `createCorrelator`, which pairs each CALL with its CALLRESULT or
  CALLERROR within a `CorrelationScope` (`"conversation"`, `"chargePoint"`
  or `"global"`), lists unanswered calls and orphan responses, and gives a
  response the action of its call.
- `createFilterEngine`, which keeps the entries of a store that match a
  `TraceFilter` up to date with their counts: kinds, time range, charge
  points, connectors, OCPP versions, directions, message types, actions,
  message ids, sessions, tenants, sources, delivery statuses, host-defined
  fields (`FilterFieldDefinition`) and a metadata text search. An engine
  created with `payloadSearch: true` allows a filter with
  `searchPayloads: true`, which also searches payloads, raw frames and
  error details. A malformed filter is rejected with a `RangeError`.
- `computeStats`, which counts the observed values of entries to build
  filter choices, and `readEntryFields`, which reads the display values of
  an entry as a filter reads them.
- Host extension types `ColumnDefinition`, `FilterFieldDefinition` and
  `ViewerSelection`, shared with the UI packages.
- Error reporting: the store, the correlator and the filter engine never
  rethrow a listener error to the caller that made the change. They pass it
  with a `ViewerErrorContext` to the `onError` of their options, else to
  `globalThis.reportError`, else to `console.error`.
  `reportViewerError` applies the same rules for a host's own components.
- `VIEWER_CORE_VERSION`, the version of this package.

[unreleased]: https://github.com/open-ocpp-trace/viewer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/open-ocpp-trace/viewer/releases/tag/v0.1.0
