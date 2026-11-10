# @open-ocpp-trace/viewer-react

React components of the Open OCPP Trace viewer: a virtualized trace list, a filter panel, an entry inspector and
`<TraceViewer>`, which composes them. The data model (store, correlation, filters) lives in the framework-neutral
`@open-ocpp-trace/viewer-core`.

## Install

The package is published to GitHub Packages from 0.1.0. Map the `@open-ocpp-trace` scope and set a token with
`read:packages` first, as the [root README](../../README.md#registry-setup) shows, then:

```sh
npm install @open-ocpp-trace/viewer-react @open-ocpp-trace/viewer-core
pnpm add @open-ocpp-trace/viewer-react @open-ocpp-trace/viewer-core
bun add @open-ocpp-trace/viewer-react @open-ocpp-trace/viewer-core
```

`@open-ocpp-trace/viewer-core` is a dependency of this package, pinned to the same version; install it too, at that
version, because the host imports `createViewerStore` from it. The SDK package `@open-ocpp-trace/jsonl` comes as a
dependency from the same registry.

React and React DOM 18 or 19 are peer dependencies. Import the stylesheet once, anywhere in the host:

```ts
import "@open-ocpp-trace/viewer-react/styles.css";
```

## Usage

The host owns the store and feeds it; the viewer only reads it.

```tsx
import { createViewerStore } from "@open-ocpp-trace/viewer-core";
import { TraceViewer } from "@open-ocpp-trace/viewer-react";

const store = createViewerStore();
store.load(entries); // ViewerEntry[]: traces, unparsed frames and gaps

export function Traces(): ReactElement {
  return (
    <div style={{ height: 480 }}>
      <TraceViewer store={store} />
    </div>
  );
}
```

`<TraceViewer>` fills the height of its container: give the container a height. Later entries arrive through
`store.apply([{ type: "add", entry }])`.

## API

| Export                                       | Purpose                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `<TraceViewer>`                              | The list, the filter panel and the inspector over a `ViewerStore` ([Props](#props)) |
| `<TraceList>`                                | The virtualized list of the entries a `FilterEngine` matches                        |
| `<FilterPanel>`                              | The filter UI over a `FilterEngine`, with the observed values and their counts      |
| `<EntryInspector>`                           | The safe view of one entry of a `ViewerStore`                                       |
| `useFilterEngine(store, options?)`           | A viewer-core `FilterEngine` connected to `store` while the component is mounted    |
| `exportJsonl(entries, options?)`             | Open OCPP Trace JSONL of entries (`JsonlExport`), faithful or redacted              |
| `defaultSensitiveKeys`                       | The property names the inspector and the redacted export treat as sensitive         |
| `defaultStrings`                             | The English texts and labels ([Localization](#localization))                        |
| `themeTokens`                                | The names of the design tokens ([Theming](#theming))                                |
| `VIEWER_REACT_VERSION`, `hostReactVersion()` | The version of this package, and the version of the React copy the host provides    |

The component props are exported as `TraceViewerProps`, `TraceListProps`, `FilterPanelProps` and
`EntryInspectorProps`.

## Props

**Component props** are plain React props of `<TraceViewer>` (see `TraceViewerProps` for the full list):

| Prop                                                          | Purpose                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `store`                                                       | The entries to show (required)                                              |
| `filter` / `defaultFilter` / `onFilterChange`                 | Controlled or uncontrolled `TraceFilter`                                    |
| `selection` / `defaultSelection` / `onSelectionChange`        | Controlled or uncontrolled `ViewerSelection`                                |
| `payloadSearch`                                               | Lets the text search read payloads                                          |
| `loading`, `error`                                            | Host status, shown in the list                                              |
| `onExport`                                                    | Shows the export buttons and receives the JSONL text built by `exportJsonl` |
| `redactExport`                                                | Redacts the exports ([Redacted export](#redacted-export))                   |
| `onCopy`, `renderPayload`, `revealSensitive`, `sensitiveKeys` | Inspector behaviour                                                         |
| `theme`                                                       | Color scheme and tokens of this viewer ([Theming](#theming))                |
| `strings`, `translate`                                        | Localization ([Localization](#localization))                                |
| `columns`, `filterControls`, `toolbarActions`, `detailPanels` | Host slots ([Slots](#slots))                                                |
| `onError`                                                     | Receives host callback errors ([Error reporting](#error-reporting))         |

**Integration adapters** come from `@open-ocpp-trace/viewer-core` and connect the viewer to a data source; they
have no React dependency:

- `createViewerStore(options)`: the bounded store a `ViewerStore` prop expects (`load`, `apply`, `pause`, `resume`).
- `ViewerAdapter`: a source exposing `snapshot()` and `subscribe(listener)`. The host loads the snapshot into the
  store and passes each batch of `EntryUpdate`s to `store.apply`.
- `createCorrelator({ scope })`: pairs CALLs with their responses. `correlator.connect(store)`, then pass it as
  `correlator` to enable the inspector's response and CALL links.
- `ColumnDefinition` (`columns`) and `FilterFieldDefinition` (`fields`): host columns and filterable producer
  fields, described by value only.

## Theming

Every rule of the stylesheet is scoped to an `oot-` class; the file has no global reset, `:root`, element or
`@font-face` rule.

`<TraceViewer theme={…}>` themes one viewer, on its root element only:

```tsx
<TraceViewer
  store={store}
  theme={{ colorScheme: "dark", tokens: { background: "#10151c", borderColor: "#2a3442" } }}
/>
```

- `colorScheme`: `"light"`, `"dark"` or `"auto"` (default, follows `prefers-color-scheme`). It is set as
  `data-oot-color-scheme` on the root, which sets the CSS `color-scheme`: the default colors are system colors
  (`Canvas`, `CanvasText`, `Highlight`) that follow it.
- `tokens`: overrides of the tokens below, as CSS values. Each one is set inline on the root as its custom
  property (`borderColor` → `--oot-border-color`). Two viewers in one page keep their own tokens.

A host may set the same `--oot-*` properties on any ancestor instead, in its own CSS; the stylesheet only reads
them and never declares them, so a host value always wins over the defaults, in both color schemes. Tokens given
through the `theme` prop win over ancestor values. `themeTokens` lists the token names.

| Token                | CSS property                | Default                     |
| -------------------- | --------------------------- | --------------------------- |
| `alertColor`         | `--oot-alert-color`         | dark red, light red on dark |
| `background`         | `--oot-background`          | `Canvas`                    |
| `borderColor`        | `--oot-border-color`        | `rgb(128 128 128 / 30%)`    |
| `codeMaxHeight`      | `--oot-code-max-height`     | `24em`                      |
| `color`              | `--oot-color`               | `CanvasText`                |
| `detailWidth`        | `--oot-detail-width`        | `28em`                      |
| `focusColor`         | `--oot-focus-color`         | `Highlight`                 |
| `fontFamily`         | `--oot-font-family`         | `ui-monospace, monospace`   |
| `fontSize`           | `--oot-font-size`           | `0.8125rem`                 |
| `gapBackground`      | `--oot-gap-background`      | translucent amber           |
| `headerBackground`   | `--oot-header-background`   | `rgb(128 128 128 / 12%)`    |
| `listMinWidth`       | `--oot-list-min-width`      | `16em`                      |
| `selectedBackground` | `--oot-selected-background` | `Highlight`                 |
| `selectedColor`      | `--oot-selected-color`      | `HighlightText`             |
| `unparsedBackground` | `--oot-unparsed-background` | translucent red             |

A standalone `<TraceList>`, `<FilterPanel>` or `<EntryInspector>` has no viewer root: it reads the same tokens
from its ancestors and follows the page's color scheme.

## Localization

The texts, accessible labels and statuses the components show come from `defaultStrings` (English), including
the markers the inspector prints inside its blocks in place of hidden values (`inspector.markers.*`:
`"[redacted]"`, `[Circular]`, `{…}`…), which copied blocks use too. A host replaces them with two props, on `<TraceViewer>` (which passes them to everything it renders) or on a standalone
`<TraceList>`, `<FilterPanel>` or `<EntryInspector>`:

- `strings`: a partial copy of `defaultStrings` (`PartialViewerStrings`): any subset of the leaves, nested
  objects partial, each leaf a string or a function of the same signature.

  ```tsx
  const fr = { toolbar: { pause: "Pause", pending: (count: number) => `${count} en attente` } };
  <TraceViewer store={store} strings={fr} />;
  ```

- `translate(key, params)` (`TranslateFunction`): the key is the dotted path of the leaf in `defaultStrings`
  (`"toolbar.exported"`, `"inspector.fields.messageId"`, `"columns.action"`, `"filter.kindNames.gap"`, `"gap"`),
  and `params` the named arguments of a function leaf (`{}` for a plain string). Returning `undefined` keeps the
  next source.

Per leaf, the first that applies wins: a string returned by `translate`, then the `strings` leaf, then the default.
The strings are resolved again only when the identity of `strings` or `translate` changes: memoize both (a new
object or function on every render resolves every string on every render). A `translate` that throws is
reported to `onError` ([Error reporting](#error-reporting)) and the leaf falls back; the viewer stays mounted.

A standalone component's own `strings` or `translate` replace those of the enclosing `<TraceViewer>` instead of
merging with them: an `<EntryInspector strings={…}>` rendered inside a detail panel no longer sees the viewer's
`translate`, so pass it both props.

Function leaves and their named parameters:

| Key                   | Parameters                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `toolbar.pending`     | `count`                                                                                            |
| `toolbar.exported`    | `count`, `skipped`                                                                                 |
| `gap`                 | `missedCount`, `reason` (both may be `null`)                                                       |
| `inspector.totalSize` | `chars`                                                                                            |
| `inspector.copy`      | `block`                                                                                            |
| `inspector.candidate` | `position`                                                                                         |
| `inspector.source`    | `id`, `label` (may be `null`)                                                                      |
| `inspector.delivery`  | `target`, `role`, `status`, `reason`, `updatedAt` (`role`, `reason` and `updatedAt` may be `null`) |
| `filter.invalid`      | `reason`                                                                                           |
| `filter.clearGroup`   | `legend`                                                                                           |
| `filter.option`       | `value`, `count`                                                                                   |

`filter.invalid`'s `reason` is the filter engine's own message, in English, and a copied block cut at its size
limit ends with `…[truncated]`, also in English. Host strings (the labels of host
columns, the `error` prop) are shown as given.

A bridge to i18next, without any dependency of the viewer on it:

```ts
const translate: TranslateFunction = (key, params) =>
  i18n.exists(`ocppViewer.${key}`) ? i18n.t(`ocppViewer.${key}`, params) : undefined;
```

## Slots

Four props of `<TraceViewer>` add host UI without forking the viewer. Each slot has an `id`, unique within its
prop: elements are keyed by it, and a duplicate id is ignored with one `console.warn`. Labels and titles are
host strings, shown as given (`translate` does not apply to them). Slot functions are read at call time, so a new
array per render neither remounts the slots nor re-runs anything; memoize the arrays anyway.

Slots get the untouched store entries, sensitive fields included: `sensitiveKeys` and `revealSensitive` apply only
to the inspector. A column, an action or a panel that shows payload values must hide those fields itself.

- `columns: ColumnDefinition[]`: columns appended after the built-in ones, rendered from `value(entry)`.

  ```ts
  const columns: ColumnDefinition[] = [
    {
      id: "site",
      label: "Site",
      value: (entry) => {
        const site = entry.metadata?.custom?.["site"];
        return typeof site === "string" ? site : undefined;
      },
    },
  ];
  ```

- `filterControls: FilterControl[]`: rendered after the built-in groups of the filter panel, each in a
  `<fieldset>` with `label` as its legend. `render({ filter, setFilter })` gets the panel's current filter;
  `setFilter` takes the same path as a built-in control (validation, `onFilterChange`). A control usually edits
  a producer field declared in `fields`; `filter.fields` is an array of `{ id, values }`:

  ```tsx
  const siteField: FilterFieldDefinition = { id: "site", label: "Site", values: (e) => siteOf(e) };
  const northOnly: FilterControl = {
    id: "north-only",
    label: "Site",
    render: ({ filter, setFilter }) => {
      const others = (filter.fields ?? []).filter((field) => field.id !== "site");
      const on = others.length !== (filter.fields ?? []).length;
      const fields = on ? others : [...others, { id: "site", values: ["north"] }];
      return (
        <label>
          <input type="checkbox" checked={on} onChange={() => setFilter({ ...filter, fields })} />
          North only
        </label>
      );
    },
  };
  <TraceViewer store={store} fields={[siteField]} filterControls={[northOnly]} />;
  ```

- `toolbarActions: ToolbarAction[]`: buttons after the built-in toolbar buttons. `run(context)` and the optional
  `disabled(context)` get a `ViewerActionContext`: `store`, `selection`, `selectedEntry`, `listed()` (the
  entries the filter lists, in order) and `select(entryId)`.

  ```ts
  const actions: ToolbarAction[] = [
    {
      id: "copy-ids",
      label: "Copy IDs",
      disabled: (context) => context.listed().length === 0,
      run: (context) =>
        copy(
          context
            .listed()
            .map((entry) => entry.id)
            .join("\n"),
        ),
    },
  ];
  ```

- `detailPanels: DetailPanel[]`: sections under the inspector for the selected entry, shown only for the
  entries `appliesTo(entry)` accepts (all by default). `render(context)` gets a `DetailPanelContext`: `entry`,
  `store`, `correlator` and `select(entryId)`. A panel that throws shows the `detailPanelError` string in its place
  and recovers on the next entry; the viewer stays usable. A host component library plugs in here, for example a
  failure summary like DebugKit's, without the viewer depending on it:

  ```tsx
  const panels: DetailPanel[] = [
    {
      id: "failure",
      title: "Failure",
      appliesTo: (entry) => entry.kind === "trace" && entry.record.messageType === "CALLERROR",
      render: ({ entry, select }) => <FailureSummary entry={entry} onOpen={select} />,
    },
  ];
  ```

A filter control that throws while rendering shows the `filterControlError` string in its fieldset until another
control object is passed.

A throw in `run`, `disabled` or `appliesTo` is reported to `onError` ([Error reporting](#error-reporting)): the
action or the panel is disabled or hidden, and the viewer stays mounted.

## Callbacks

- `onSelectionChange(selection, entry)`: called when the user or a slot selects an entry, with that entry (or
  `undefined` when the store does not hold it), and once with `{ entryId: null }` when the selected entry leaves
  the store. Pair it with `selection` for a controlled selection, for instance to sync an external timeline.
- `onFilterChange(filter)`: called with every filter the user or a filter control builds, in both modes.
- `onExport(exported, scope)`: receives the JSONL export of the selection or of the filtered entries.

`onSelectionChange` is read at call time: a new function per render is never called for an earlier change.

## Redacted export

Exports are faithful by default: records are written unmodified, sensitive fields included. A host that hands
exports to third parties sets `redactExport` on `<TraceViewer>`; both export buttons then call
`exportJsonl(entries, { redact: true, sensitiveKeys })` with the `sensitiveKeys` prop (default
`defaultSensitiveKeys`). `revealSensitive` only affects the detail panel, never the export. The viewer shows no
control for it: the host decides the policy.

- The value of every property whose name is a sensitive key, case-insensitively, at any depth and inside arrays,
  becomes `"[redacted]"`, as in the detail panel. This applies to `payload`, `error` (all but `code`), `meta` and
  unknown top-level fields; schema fields (`messageId`, `action`, `timestamp`…) are never touched. The redaction
  works on the record's JSON form (every `toJSON` applied, every getter read once), so what is written is exactly
  what was checked.
- `raw` is kept verbatim when it is a JSON frame of at most 1 000 000 characters whose parse holds no sensitive
  key. Otherwise it is dropped, never rewritten: a frame holding a sensitive key, a SOAP frame, a frame that is
  not JSON or a larger one.
- Each record gets `meta.redaction = { by: "@open-ocpp-trace/viewer-react", rawDropped }`, added after `meta`
  itself is redacted and replacing any producer value under that key. `rawDropped` is true when the record had
  a `raw` that was dropped. The marker names no key and no value.
- A record the redaction cannot read or serialize (a throwing getter or proxy, a cycle, too deep a nesting) is
  counted in `skipped.invalid`, never written unredacted, and so is a record whose `meta` is `null`, as in the
  faithful export. The input entries are never mutated.

Matching is by property name only: a secret carried as a value, such as the value of a `SetVariables` entry
whose variable is `BasicAuthPassword`, is not detected.

## Error reporting

An error thrown by a host callback that no caller of the host is left to receive is passed to `onError`
(`ViewerErrorHandler` from `@open-ocpp-trace/viewer-core`) with a `ViewerErrorContext`, `{ component, callback }`;
the viewer stays mounted and keeps delivering the other callbacks.

| `component`                                                           | `callback`                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `"TraceViewer"`                                                       | `"translate"`, `"onSelectionChange"`, `"toolbarActions.run"`, `"toolbarActions.disabled"`, `"detailPanels.appliesTo"` |
| `"TraceList"`, `"FilterPanel"`, `"EntryInspector"`                    | `"translate"` (their own `translate` prop)                                                                            |
| `"filterEngine"` (the engine of `<TraceViewer>` or `useFilterEngine`) | `"listener"`, `"follow"`, `"correlate"`, `"setFilter"`                                                                |

`<TraceViewer>` passes its `onError` to the components it renders and to its filter engine; `useFilterEngine`
forwards `options.onError` the same way. The handler is read when an error is reported: a new function on every
render recreates nothing.

Without `onError`, an error goes to `globalThis.reportError` when it is a function, else to `console.error`. If
`onError` throws, that default receives the original error, then the handler's error; nothing is rethrown.

The store and the correlator belong to the host: give them their own handler, which can be the same function.
`createViewerStore({ onError })` reports `{ component: "store" }` errors (`"listener"`, never rethrown to the
caller of `apply` or `load`, `"queued"` for a change a listener requested, such as a batch whose iterator throws,
and `"snapshot"` for a promised adapter snapshot, or a batch buffered before it, that
fails to apply); `createCorrelator({ onError })` reports `{ component:
"correlator" }` errors (`"listener"`, `"follow"`). Core's `reportViewerError(onError, error, context)` applies the
same rules for a host's own components.
