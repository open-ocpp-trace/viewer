# Changelog

All notable changes to `@open-ocpp-trace/viewer-react` are documented in this
file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

First release of the React components of the Open OCPP Trace viewer. React
and React DOM 18 or 19 are peer dependencies; the data model comes from
`@open-ocpp-trace/viewer-core`.

### Added

- `<TraceViewer>`, which composes the list, the filter panel and the
  inspector over a host-owned `ViewerStore`, with a toolbar to pause and
  follow live traffic (with the count of pending entries). Filter and
  selection are controlled or uncontrolled (`filter`, `defaultFilter`,
  `onFilterChange`, `selection`, `defaultSelection`, `onSelectionChange`),
  and `loading` and `error` show the host status.
- `<TraceList>`, a virtualized grid of traces, unparsed frames and gaps,
  with a button to jump to the latest entry.
- `<FilterPanel>` and `useFilterEngine`, the filter UI over the
  viewer-core filter engine, with the observed values and their counts.
- `<EntryInspector>`, a safe view of the selected entry: fields, payload,
  error details, raw frame, meta and custom metadata, with links between a
  CALL and its response. Sensitive fields (`defaultSensitiveKeys`, or the
  `sensitiveKeys` prop) are shown as `"[redacted]"`, and a raw frame that
  may hold one is hidden, unless `revealSensitive` is set; large or deep
  values are cut, and every block can be copied.
- JSONL export: `exportJsonl` and the `onExport` prop, which adds buttons
  to export the selection or the filtered entries as Open OCPP Trace JSONL.
  Exports are faithful by default.
- Opt-in redacted export: with `redactExport`, both export buttons replace
  the value of every sensitive key with `"[redacted]"`, drop any `raw`
  frame that holds one or cannot be checked, and mark each record with
  `meta.redaction`.
- Theming: a stylesheet (`@open-ocpp-trace/viewer-react/styles.css`) whose
  rules are all scoped to `oot-` classes, `--oot-*` design tokens
  (`themeTokens`), and a `theme` prop for the color scheme (`"light"`,
  `"dark"` or `"auto"`) and the tokens of one viewer.
- Localization: every text and accessible label comes from
  `defaultStrings` (English) and can be replaced through the `strings` and
  `translate` props, for example to bridge i18next.
- Host slots that add UI without forking the viewer: `columns`,
  `filterControls`, `toolbarActions` and `detailPanels`. A slot that throws
  is contained and the viewer stays usable.
- The viewer's controls keep their look under a host's global base styles,
  such as Tailwind preflight or form resets.
- Error reporting: an error thrown by a host callback (`translate`,
  `onSelectionChange`, a toolbar action, a detail panel's `appliesTo`) or
  by the filter engine goes to the `onError` prop with a
  `ViewerErrorContext`; the viewer stays mounted.
- `VIEWER_REACT_VERSION`, the version of this package, and
  `hostReactVersion()`, the version of the React copy the host provides.

[unreleased]: https://github.com/open-ocpp-trace/viewer/commits/main/packages/react
