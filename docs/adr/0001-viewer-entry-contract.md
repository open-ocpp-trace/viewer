# ADR 0001: Viewer entry and adapter contract

- Status: accepted
- Date: 2026-11-09
- Issue: #2

## Context

The viewer displays traffic from several producers: OCPP CP Simulator, OCPP DebugKit and OCPP Gateway.
Each has its own internal model, transport and extra context (tenant, session, routing outcomes). The
Open OCPP Trace SDK (`@open-ocpp-trace/core`) owns the `TraceRecord` type, which only describes
conformant OCPP-J frames. Producers also see frames that are not conformant, and live streams lose
frames when a connection drops. The viewer needs one contract for all of this before the store (#3),
correlation (#4), filters (#5) and UI (#6–#9) are built on it.

## Decision

### Entry kinds

`ViewerEntry` is a discriminated union on `kind`, separate from `TraceRecord`:

- `trace` (`TraceEntry`): wraps one conformant `TraceRecord`, whose `timestamp` is the entry timestamp;
- `unparsed` (`UnparsedEntry`): a frame kept `raw` with the producer's `reason`, plus the timestamp,
  direction and transport when known (typed from `TraceRecord`, not redeclared);
- `gap` (`GapEntry`): a point where entries may be missing, with a `GapReason` and an optional
  `missedCount`.

`unparsed` and `gap` entries are not `TraceRecord`s and cannot be assigned to one: turning them into
records would mean inventing a message type, an id or a direction, and a viewer export would then
produce traces that claim a conformance they do not have. Application log messages (diagnostics,
scenario logs) are out of scope until they are designed explicitly.

### Identity and source-owned data

Every entry has an `EntryId`, a plain `string`. Adapters build it from their own keys (a gateway trace
id, a simulator counter), so a branded type would only force casts at every adapter boundary. An entry
may carry `receivedAt` (RFC 3339 arrival time at the viewer or adapter) and `metadata`.

The record is source-owned: `TraceEntry.record` is `Readonly<TraceRecord>`, and the viewer never
mutates or copies it. All viewer data (identity, arrival time, producer context) lives beside the
record, in the entry, never inside it or its `meta`. Every entry field is `readonly`.

### Metadata and precedence

`EntryMetadata` holds optional producer context: `tenant`, `chargePointId`, `sessionId`,
`conversationId`, `source` (`EntrySource`), `deliveries` (`EntryDelivery[]`) and `custom` fields.

A field present on the record wins; metadata only supplies context the record lacks. The effective
charge point of a trace entry is `record.chargePointId ?? metadata.chargePointId`. The same record can
therefore be displayed bare or wrapped with any producer's context without changing what it says.

`EntryDelivery` mirrors the OCPP Gateway's `Delivery`: `target`, `role`, `status`, `reason`,
`updatedAt`. `updatedAt` is an RFC 3339 string instead of a `Date`, and `role` and `updatedAt` are
optional for producers that do not have them. Statuses (`queued`, `submitted`, `written`, `failed`,
`dropped`), roles and gap reasons are open unions: an unknown value is kept and displayed as is.

### Updates

`EntryUpdate` is either `{ type: 'add', entry }` or `{ type: 'update', id, revision?, metadata }`.
The store (#3) applies these rules:

1. **Staleness.** When `revision` is present, an update whose revision is lower than or equal to the
   last revision applied to that id is ignored. Without `revision`, arrival order wins (last write
   wins). The revision is per entry, not per field: an adapter must emit revisions that increase per
   entry across all its updates, or omit them.
2. **Unknown id.** An update for an id the store does not hold is dropped and counted, not buffered.
   This also covers an entry already evicted.
3. **No resurrection, no reordering.** An update never brings back an evicted entry and never moves an
   entry in the list.
4. **Immutable core fields.** An update only carries a metadata patch, so it never touches `record`,
   `kind`, `id` or `raw`.
5. **Merge.** The patch (`EntryMetadataPatch`) is merged shallowly per metadata field. `custom` is
   merged per key. `deliveries` is merged **per target**: each delivery in the patch replaces the
   existing delivery with the same `target`, a new target is appended, and other targets keep their
   state and order. The gateway sends the full delivery list once, with the frame, then one
   delivery at a time as its status changes, addressed by its index in that list; a full-list
   replacement would force its adapter to keep every list, while a per-target merge only needs the
   index-to-target mapping it saw on `add`. A patch cannot remove a field.
6. **Duplicate add.** An `add` for an id already held is ignored and counted.

Core does not rank delivery statuses: the gateway's forward-only rule (`queued` → `submitted` → a
final status) is its own semantics, and an open status union cannot rank unknown values. An adapter
that needs it enforces it before emitting.

### Adapter contract

`ViewerAdapter` exposes `snapshot()` (synchronous or a promise) and `subscribe(listener)`, which
receives batches of `EntryUpdate`s and returns an `Unsubscribe`. The viewer takes the snapshot, then
subscribes. Transports (WebSocket, SSE, polling) and codecs (JSONL, producer envelopes) stay in
adapters and examples; core has no transport type. A connection loss is reported by the adapter as a
`gap` entry.

### Selection and extensions

`ViewerSelection` holds one `entryId` or `null`: single selection in v0.1. Extensions are described by
value only, so they work from React, the standalone build or an external analyzer alike:
`ColumnDefinition` yields a cell value, `FilterFieldDefinition` yields the values an entry can be
filtered on. Rendering hooks belong to viewer-react (#8), filter operators and the engine to #5.

## Consequences

- Adapters own the mapping from their model to entries; the compile-only sketches in
  `packages/core/test/sketches/` check that the simulator and gateway mappings fit.
- Core depends on the SDK for types only and re-exports none of them: consumers import `TraceRecord`
  from `@open-ocpp-trace/core`.
- Producer context never leaks into records, so a JSONL export of trace entries stays conformant.
- Clearing a metadata field, multi-selection and application logs need a later decision.
