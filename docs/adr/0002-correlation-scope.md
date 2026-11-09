# ADR 0002: Correlation scope

- Status: accepted
- Date: 2026-11-09
- Issue: #4

## Context

The Open OCPP Trace correlation rule pairs a CALLRESULT or CALLERROR with the most recent preceding
unanswered CALL with the same `messageId` and the opposite `direction`. A `messageId` is unique only
within one WebSocket connection, but a viewer stream mixes connections: a gateway or a CSMS sees many
charge points and sessions, a simulator replays several runs, and a gateway mirrors one charger CALL to
a primary and a secondary CSMS. Correlating across all of them claims answers that are wrong, and an
id reused by two charge points is the common case, not the exception.

The viewer store (ADR 0001) is bounded: it evicts the oldest listed entries, drops pending entries while
paused and lists gaps. Correlation must stay correct, bounded and incremental on that stream.

## Decision

### Scope and key

`createCorrelator({ scope })` applies the rule inside one bucket, keyed by:

| Scope                    | Key                                          |
| ------------------------ | -------------------------------------------- |
| `conversation` (default) | effective charge point, `metadata.sessionId` |
| `chargePoint`            | effective charge point                       |
| `global`                 | none: one bucket for the stream              |

The effective charge point follows the ADR 0001 precedence:
`entry.record.chargePointId ?? entry.metadata?.chargePointId`. `tenant` and `conversationId` are not
part of any key in v0.1.

A missing or non-string component is _unknown_, a value distinct from every string. Unknown matches only
unknown: two records match only when every component is identical. Two different known values never
match, so a trace without any charge point or session behaves like `global`, and a known key never
silently pairs with an unknown one.

The key is computed once, when the entry is first listed. A later metadata update (ADR 0001 rule 3)
does not re-correlate: results stay stable while metadata arrives late. Reloading the stream applies
the final metadata.

### Rule inside a bucket

Entries are processed in store list order, the unfiltered chronological stream; no filter or selection
is an input. Per (bucket, CALL direction, `messageId`) the correlator keeps a stack of unanswered CALLs
and pops the newest on an answer, so an older unanswered CALL stays eligible when the newest is already
answered. No match makes the response an _orphan_. A response's effective action is its CALL's; an
orphan keeps only its own explicit `action`.

Gap and unparsed entries never correlate. A trace entry with another `messageType`, a non-string
`messageId`, an unknown `direction`, or a CALL without a string `action` is uncorrelatable: ignored,
never thrown. Records are read once and never mutated; nothing is written into entries.

### Candidates: ambiguity is explicit, never claimed

A CALL is _compatible_ with a response when it has the same `messageId`, the opposite direction,
precedes it, and no key component holds two different known values (unknown on one side is allowed).

- A matched response lists the other compatible CALLs still unanswered at match time. Non-empty means
  the match follows the rule but is ambiguous.
- An orphan lists every compatible listed CALL, answered or not. With a gateway mirroring one CALL to two
  CSMS that both answer in one session, the first answer correlates and the second is an orphan whose
  candidates hold the CALL.

The list holds at most 8 ids, newest first, from a scan of the 64 most recent listed CALLs with that
direction and `messageId`. `candidatesTruncated` is true when either bound cut the list. Candidate ids
may name entries evicted since.

An orphan's `incompleteHistory` is true when, since connect or the last clear, the store evicted or
dropped anything or listed a gap before it: its CALL may be missing. Evictions and drops before connect
count too (`getStats()` at connect). The store's events are net deltas, so an entry added and evicted
in one batch is caught by the `evicted` and `droppedPending` counters, not by the event lists.

### Store integration

`connect(store)` seeds from the listed entries, then follows each store change: `cleared` resets every
index and the incomplete-history flag, `evicted` ids leave every index, `added` entries are correlated in
order (a CALL and its response may share a batch), `updated` entries are ignored. A store change gives
at most one `CorrelationChange`: `changed` lists ids whose correlation appeared or changed (a CALL
gaining its `responseId`), `removed` the evicted ids that had one, `cleared` a reset.

Eviction keeps a response's `callId` and `action` after its CALL leaves; a CALL evicted unanswered leaves
`unansweredCalls()`; a response arriving after its CALL was evicted is an orphan with an incomplete
history. Paused entries are correlated when the store lists them on resume, in arrival order.

One store at a time: a second `connect` throws. The returned `Unsubscribe` stops following, resets the
state, emits `cleared: true` if anything was correlated, and allows a new `connect`.

Listeners run in subscription order and a throwing listener does not stop the others. Unlike the store,
the correlator never rethrows: it runs inside the store's listener, so an error would surface in the
caller of `apply`, which has no part in it. The first listener error of a change is reported as an
unhandled promise rejection instead.

### Bounds

- Memory: O(listed trace entries), so bounded by the store's `maxEntries`, plus at most 8 candidate ids
  per response. Indexes are nested `Map`s keyed by `EntryId` and field values; no composite string key
  copies a `messageId`, and untrusted strings such as `__proto__` stay plain data.
- Time per store change: O(added + evicted) amortized, plus a candidate scan of at most 64 CALLs per
  response.

## Consequences

- Viewers default to `conversation`; a stream without charge point or session metadata still correlates,
  as one bucket. `chargePoint` or `global` can recover pairs split by missing or inconsistent sessions,
  at the cost of more ambiguity, which the candidates expose.
- A result never changes because metadata arrived late; switching scope or reloading is the way to apply
  new metadata.
- The UI can flag ambiguous matches and orphans whose CALL may have been evicted without guessing.
- Adding `tenant` or `conversationId` to the key is an open question for a later version.
