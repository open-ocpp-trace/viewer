# @open-ocpp-trace/viewer-core

The framework-neutral model of the Open OCPP Trace viewer: a bounded store of viewer entries, the correlation of calls
and responses, and the filter engine. It has no DOM or React dependency. `@open-ocpp-trace/viewer-react` renders it, and
`@open-ocpp-trace/viewer-standalone` bundles both.

## Install

```sh
bun add @open-ocpp-trace/viewer-core
```

Records are typed by `@open-ocpp-trace/core`, which comes as a dependency.

## Usage

The host owns the store and feeds it; the correlator and the filter engine follow it.

```ts
import {
  createCorrelator,
  createFilterEngine,
  createViewerStore,
} from "@open-ocpp-trace/viewer-core";

const store = createViewerStore({ maxEntries: 5_000 });
const correlator = createCorrelator({ scope: "conversation" });
const engine = createFilterEngine({ correlator });

correlator.connect(store);
engine.connect(store);

store.load(entries); // ViewerEntry[]: traces, unparsed frames and gaps
store.apply([{ type: "add", entry }]);
store.apply([{ type: "update", id: "a", revision: 2, metadata: { tenant: "acme" } }]);

engine.setFilter({ kinds: ["trace"], actions: ["BootNotification"] });
for (let index = 0; index < engine.size; index++) console.log(engine.at(index));
```

Each `connect` returns an `Unsubscribe` that stops following the store.

## API

| Export                                       | Purpose                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `createViewerStore(options?)`                | The bounded, ordered `ViewerStore` of entries: `load`, `apply`, `pause`/`resume`, `clear`, `connect`          |
| `DEFAULT_MAX_ENTRIES`, `DEFAULT_MAX_BYTES`   | The default bounds of a store (`maxEntries`, `maxBytes`); the oldest entries are evicted past them            |
| `STORE_ID_PREFIX`                            | Prefix of the ids of the gaps the store lists itself (`viewer-store:`); producer ids may not use it           |
| `createCorrelator(options?)`                 | Pairs calls with their responses within a `CorrelationScope`, and lists unanswered calls and orphan responses |
| `createFilterEngine(options?)`               | The entries of a store that match a `TraceFilter`, kept up to date, with their counts                         |
| `computeStats(entries, options?)`            | Counts the observed values of entries (`TraceStats`), to build filter choices                                 |
| `readEntryFields(entry, correlator?)`        | The display values of an entry, read like a filter reads them                                                 |
| `reportViewerError(onError, error, context)` | Reports an error to a `ViewerErrorHandler`, else to `globalThis.reportError` or `console.error`               |
| `VIEWER_CORE_VERSION`                        | The version of this package                                                                                   |

The main types are `ViewerEntry` (`TraceEntry`, `UnparsedEntry`, `GapEntry`), `EntryUpdate`, `EntryMetadata`,
`TraceFilter`, `ViewerSelection`, the host extensions `ColumnDefinition` and `FilterFieldDefinition`, and
`ViewerAdapter`.

## Adapters

A `ViewerAdapter` feeds a store from one producer. `store.connect(adapter)` subscribes first, applies the snapshot, then
replays what arrived meanwhile, so nothing is lost or applied twice:

```ts
import type { ViewerAdapter } from "@open-ocpp-trace/viewer-core";

const adapter: ViewerAdapter = {
  snapshot: () => fetchEntries(), // ViewerEntry[] or a promise of one
  subscribe: (listener) => source.on("updates", listener), // returns an Unsubscribe
};

const disconnect = store.connect(adapter);
```

Transports and codecs stay in the adapter: a connection loss is reported as a `gap` entry.

## Error reporting

The store, the correlator and the filter engine never rethrow a listener error to the call that made the change. They
pass it, with its `ViewerErrorContext`, to the `onError` of their options, else to `globalThis.reportError`, else to
`console.error`.

## Design notes

- [Viewer entry contract](../../docs/adr/0001-viewer-entry-contract.md)
- [Correlation scope](../../docs/adr/0002-correlation-scope.md)
- [Filtering](../../docs/adr/0003-filtering.md)
