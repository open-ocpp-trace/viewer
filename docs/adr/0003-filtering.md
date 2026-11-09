# ADR 0003: Filtering

- Status: accepted
- Date: 2026-11-09
- Issue: #5

## Context

A viewer stream mixes charge points, sessions, tenants, gateway sources and delivery states, plus
unparsed frames and gaps (ADR 0001). Users need to narrow it without losing the signs that entries may
be missing, and hosts need a filter they can store in a URL or a preference: plain data, no functions.
Trace data is untrusted, and payloads or raw frames may hold secrets.

## Decision

### Model

`TraceFilter` is plain, serializable data. Properties combine with AND, the values of one list with OR.
An omitted property constrains nothing; an empty list matches no entry (set semantics). `{}` matches
everything, and `reset()` is `setFilter({})`.

`setFilter` validates programmer input and throws a `RangeError` on an unknown property, a non-array
list, an item of the wrong type, an unparsable `timeRange` bound or an unknown producer field id. The
compiled filter holds `Set`s; untrusted strings never index plain objects.

### Absent values

`null` in a list selects the entries lacking that value. `""` and `"unknown"` are legal values and never
mark absence. A record value of the wrong runtime type (a string `connectorId`, a non-string `action`) is
absent, and reading a value never throws. The action is `record.action`, else the action the correlator
derives (ADR 0002); records are never rewritten. Delivery statuses are multi-valued: an entry matches
when any of its statuses is selected, or when `null` is selected and it has none. A producer field whose
`values` throws or returns no string is absent. Times are compared as instants, never as strings; an
entry without a parsable time is outside any range with a bound.

### Gaps and unparsed entries

A gap passes every property but `kinds`, and the text search keeps it: a filtered view still shows where
entries may be missing. An unparsed entry keeps `kind: "unparsed"` and lacks every record field, so
`messageTypes: ["CALL"]` hides it and `messageTypes: ["CALL", null]` keeps it.

### Search

`text` is a trimmed, case-insensitive substring. By default it reads metadata only: ids, effective
action and charge point, version, message type, direction, CALLERROR `error.code`, session, tenant,
conversation, source, deliveries, the unparsed `reason` and producer field values. It never reads
payloads, raw frames, `record.meta`, `metadata.custom` or the error description and details.

Payload search takes two deliberate steps: the engine option `payloadSearch: true` and the filter flag
`searchPayloads: true`; the flag alone throws a `RangeError`. The scan is bounded per entry (64 Ki
characters, depth 32, cycles skipped, throwing getters contained) and never uses `JSON.stringify`.
Matches beyond the budget are missed. `record.meta` and `metadata.custom` stay excluded.

### Engine

`createFilterEngine` lists the matching entries of one store in store list order. Pending (paused)
entries are not listed; they join on resume. The engine follows the store and, when given, the
correlator: the order in which the two are notified is not guaranteed, so a correlator change re-evaluates
the entries and both connection orders converge. `connect` mirrors the correlator's: one store at a time,
a failing seed leaves it disconnected, a failing subscription releases the seed before rethrowing. A
`FilterChange` is notified only when the listed entries change. Listener errors are reported
asynchronously, as the correlator's are.

The first implementation recomputes the list from the store on every change, in O(n).

### Counts

Counts and statistics over the filtered entries are left to a follow-up decision with `computeStats`.

## Consequences

- A host can persist and restore a filter as JSON, and a malformed one fails loudly at `setFilter`.
- Absent values are selectable without colliding with any real value.
- Secrets in payloads stay out of search results unless the host and the user both opt in.
- A recompute per change is O(n) in the listed entries; incremental maintenance can replace it without
  changing the API.
