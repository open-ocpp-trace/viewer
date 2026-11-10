# Simulator example

A React 19 page showing `@open-ocpp-trace/viewer-react` displaying real traffic of the
[OCPP CP Simulator](https://github.com/shiv3/ocpp-cp-simulator): a two charge point capture
(`CP001`, `CP002`, OCPP 1.6J) recorded by the simulator's own TraceWriter. The page stays
independent of the simulator's logger, UI kit, i18n setup and application behaviour, and no
simulator code lives in this repository.

## Run it

The page resolves the viewer packages like a published install, to their built `dist/`, so pack
them first:

```sh
GITHUB_TOKEN=$(gh auth token) bun install
vp run -r pack
vp run @open-ocpp-trace/viewer-example-simulator#dev    # or #build, then #preview
```

Its tests run with the workspace's, against the package sources:
`vp test --project example-simulator`.

## What it shows

- **Charge point, direction, action and message type filters** (CALL, CALLRESULT and CALLERROR
  are listed as such). Responses filter by the action of their own charge point's CALL, which the
  correlator derives.
- **Connector filter and column.** The simulator's records carry no `connectorId`, so the built-in
  connector filter only offers "(none)". The page adds a producer field and a column that read
  the `connectorId` named in the payload, leaving the record untouched.
- **Response correlation**: select a CALL and follow "Go to response", or the reverse.
- **Controlled state**: the filter and the selection are held by the page, shown in a side panel
  and mirrored in the URL hash (`#cp=CP002&type=CALLERROR&sel=sim-24`), so a view can be
  bookmarked or restored.
- **JSONL export** through `onExport`: the page downloads `simulator-filtered.jsonl` or
  `simulator-selection.jsonl`, records unmodified.
- **Styling hooks**: theme tokens through the `theme` prop, and `--oot-*` properties set on the
  `simulator-viewer` class.
- **i18n**: an English/French toggle. The simulator uses i18next; the viewer only asks for a
  `translate(key, params)` function, here bridged to a tiny host dictionary (`src/i18n.ts`). A
  `strings` override applies on top in every language.
- **`meta.validation`**: the one record the simulator flagged (CP001's GetConfiguration
  `csms-0002`, a schema-breaking CSMS request) shows an "Inbound validation" detail panel, and
  the "Next validation warning" toolbar action selects it.
- **Live mode**: "Live replay" replays the captured records into an empty store through a
  `ViewerAdapter`, one per tick, in timestamp order, with play and pause.

## The adapter

The simulator-side adapter lives in `src/adapter/`, never in `packages/`:

- `trace-reader.ts` reads TraceWriter's JSONL with the SDK reader (`readRecords` of
  `@open-ocpp-trace/jsonl`) and wraps each record as a `TraceEntry`: id `sim-<line>`, the record
  untouched, metadata `{ chargePointId, source: { id: "simulator", label: "OCPP CP Simulator" } }`.
  A line the SDK cannot read is listed by the page as an unreadable line, with its number and
  the SDK's reason; it never becomes an entry.
- `live-adapter.ts` is an in-memory `ViewerAdapter`: an empty snapshot, then pushed batches.
- `replay.ts` drives the live mode from the captured records.
- `global-logs.ts` is the shape of a live integration with the simulator's web UI, whose
  `GlobalLogsProvider` keeps `{ cpId, entry, seq }` log entries in a newest-first ring buffer.
  It pushes the entries of the lines not seen yet, with ids `sim-seq-<seq>`, and lists a
  `dropped` gap when the ring buffer overflowed between two deliveries. The log-line conversion
  is injected, because it is the simulator's own (see below).

### A real simulator integration

The simulator converts its logs with its private `@ocpp-cp-simulator/trace` package, which this
example cannot import: `logLineToTraceRecord(line, { ocppVersion })` maps one `Sent:` or
`Received:` log line to a record (null for any other line), and a `TraceCorrelator` fills in the
`action` of responses, keyed by charge point and message id. A simulator-side integration would
give the feed this `toRecord`, or read its `--trace-output` file as this page does:

```ts
const correlator = new TraceCorrelator();
const toRecord: LogLineConverter = (line) => {
  const record = logLineToTraceRecord(line, { ocppVersion: "1.6" });
  return record === null ? null : correlator.observe(record);
};
```

The tests stand in for the converter with
the records of the same capture, which match its wire lines one to one.

## Trace view and log view

The viewer shows frames. The simulator's own `LogViewer` shows log lines: application, scenario,
status, configuration, server and SOAP lines as well as the frames. In v0.1 they stay two
things:

- The 60 wire lines are in the trace, as records.
- The 100 other lines are **not** turned into viewer entries. An `UnparsedEntry` is a frame the
  producer could not parse, not a log line. The page lists them in a plain host panel next to
  the viewer, which follows the viewer's charge point filter, so they are visibly kept, not
  discarded. A simulator integration keeps its `LogViewer` for them.

### SOAP

The simulator logs SOAP traffic (OCPP 1.2 and 1.5) as `SOAP POST <op>: <xml>` and
`SOAP response <op>: …` lines of type `OCPP`, and its converter returns null for them: SOAP
traffic yields no records today, and so nothing in this viewer. This capture is OCPP 1.6J only.

## Correlation across charge points

The capture holds two real message id collisions, both from the CSMS: `csms-0001` is a
GetConfiguration to CP001 and a TriggerMessage to CP002, sent in the same tick, and `csms-0002` is
a FooBar to CP002 and a GetConfiguration to CP001. The page correlates with scope `chargePoint`
(ADR 0002); with no session id, the default `conversation` scope behaves the same.

Where the trace is observed matters. In the simulator's order (this file), each charge point
answers before the CSMS's CALL with the same id reaches the other one, so even scope `global`
pairs them right. In the order the CSMS observed (`fixtures/csms-frames.jsonl`), both CALLs
precede both answers, and `global` pairs CP001's answer with CP002's TriggerMessage, listing the
right CALL only as a candidate. `test/correlation.test.ts` protects both cases with the real
records, store and correlator. The page keeps one scope and one order rather than a toggle that
would show no difference on its own data.

## Fixtures

`fixtures/` holds the capture verbatim; `fixtures/HOW.md` gives its provenance: simulator commit,
command line, CSMS behaviour and counts.
