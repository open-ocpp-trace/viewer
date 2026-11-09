# DebugKit example

A host page that shows the viewer and
[OCPP DebugKit](https://www.npmjs.com/package/@ocpp-debugkit/toolkit) side by
side on the same trace. The viewer (`<TraceViewer>` from
`@open-ocpp-trace/viewer-react`) lists the entries of a `ViewerStore`;
DebugKit (`@ocpp-debugkit/toolkit` 0.4.8) analyzes a snapshot of that store
and shows its `SessionTimeline`, `MessageInspector` and `FailureSummary`.
Selecting a row selects its DebugKit event, and selecting an event selects its
row, when the two can be matched with certainty.

The integration lives entirely in this folder. DebugKit is a dependency of this
example only: no package under `packages/` declares or imports it
(`packages/core/test/host-isolation.test.ts` checks the manifests, the sources
and `bun.lock`), and the example does not reimplement any DebugKit analysis.

## Run it

From the repository root, after `bun install --frozen-lockfile` with
`GITHUB_TOKEN` set (see the root [README](../../README.md)):

```sh
vp run @open-ocpp-trace/viewer-example-debugkit#dev     # start the page
vp run @open-ocpp-trace/viewer-example-debugkit#build   # build it
vp test examples/debugkit                               # run its tests
```

The example's `package.json` scripts are `vp dev`, `vp build` and `vp test`;
the root `vp test` also runs these tests (project `debugkit`).

## What the page loads

The store holds, read with the released SDK reader (`@open-ocpp-trace/jsonl`):

1. the vendored specification fixture `failed-auth`
   (`packages/core/test/fixtures/spec/failed-auth/trace.jsonl`);
2. [`src/fixtures/hand-written-edge-cases.jsonl`](src/fixtures/hand-written-edge-cases.jsonl),
   seven lines written for this example, not a specification fixture. They
   cover a record without `messageId` (DebugKit drops it), a `raw` frame whose
   messageId differs from the record's field (DebugKit uses `raw`), a `raw`
   that is not a frame (DebugKit falls back to the fields), a CALL without
   `action` (the SDK reader rejects the line: an unparsed entry), and two
   CALLERRORs with the same messageId, direction and timestamp, one without
   `error.code`, which DebugKit drops (an ambiguous pair).

## The snapshot handed to DebugKit

`parseOpenOcppTrace` only accepts a whole JSONL document as a string. The
example therefore builds a snapshot ([`src/snapshot.ts`](src/snapshot.ts)):
the store's `trace` entries, in store order, one line each written with the
SDK writer (`serializeRecord`), with a parallel list of entry ids (line _k_
comes from entry _k_).

- **Scope: the whole store**, not the filtered list, so changing a filter
  never calls for a new analysis.
- **Never sent:** unparsed entries and gap markers are not records; records
  the SDK writer rejects are counted and left out too.
- **Bounded:** at most 5,000 lines and 4 MiB, well below DebugKit's limits
  (10,000 events, 10 MiB). Beyond them the oldest entries are left out and
  the status area says how many.
- **Equivalent, not byte-identical:** for the loaded fixtures the snapshot
  carries the same records, in the same order, as their conformant lines
  (`test/snapshot.test.ts`); the SDK writer may serialize them differently
  from the original bytes.

Re-serializing the store on every ingested record would cost O(n) per
record, O(n²) for a live trace. A store change only marks the analysis stale
([`src/scheduler.ts`](src/scheduler.ts)); one analysis runs when a 1-second
window closes, so a steady stream still gets one analysis per window, and
analyses never overlap. The « Analyze now » toolbar action runs one at once.

## Matching entries and events

`Event.id` is not a line index: DebugKit numbers its events (`evt-0001`, …)
over the records it accepted, so every record it drops shifts the later ids.
It never reorders them, so the events form an ordered subsequence of the
snapshot lines. [`src/mapping.ts`](src/mapping.ts) aligns the two in order,
matching on what DebugKit keeps of a record: messageId and message type (from
`raw` when it parses as an OCPP-J frame, as DebugKit does), direction and
timestamp.

The mapping fails closed; nothing is guessed. An entry without an event says
why:

- **ignored:** DebugKit dropped the record (see its warnings);
- **ambiguous:** several lines could be the source of one event, so none of
  them is mapped, and selecting that event says so;
- **unparsed** (or gap): the entry was never sent to DebugKit;
- **mapping broken:** the events do not fit the snapshot, so nothing is
  mapped and the status area gives the reason;
- also **pending**, **rejected** (DebugKit threw a `ParseError` on the whole
  snapshot) and **not sent** (left out by the snapshot limits).

DebugKit's warnings are shown verbatim for the whole analysis. Their `index`
refers to different spaces (JSONL line, parsed value, schema-valid record),
so a warning is never attached to an entry.

## Browser notes

- **`Buffer` shim.** DebugKit 0.4.8 checks its input size with
  `Buffer.byteLength`, which browsers lack. [`src/buffer-shim.ts`](src/buffer-shim.ts)
  provides only `byteLength` (counted with `TextEncoder`), only when `Buffer`
  is absent, and `src/main.tsx` imports it first. It is not a Buffer polyfill.
  Tests run on Node, where `Buffer` exists, so they remove it to check the
  shim.
- **No `ReportViewer`.** DebugKit's `ReportViewer` renders an HTML string;
  trace content is untrusted and is never rendered as HTML, so the example
  does not use it.
