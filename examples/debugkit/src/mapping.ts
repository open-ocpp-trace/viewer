import {
  classifyMessageType,
  normalizeTimestamp,
  rawOcppMessageSchema,
  type Direction,
  type Event,
  type MessageType,
} from "@ocpp-debugkit/toolkit/core";
import type { TraceRecord } from "@open-ocpp-trace/core";
import type { EntryId } from "@open-ocpp-trace/viewer-core";

import type { SnapshotLine } from "./snapshot.ts";

/**
 * The identity mapping between the viewer entries of a snapshot and the
 * DebugKit events parsed from it. Only certain correspondences are listed.
 */
export interface EventMapping {
  /** `"broken"`: the events do not fit the snapshot, nothing is mapped. */
  readonly status: "aligned" | "broken";
  /** Why the alignment broke, when it did. */
  readonly reason?: string;
  readonly eventByEntry: ReadonlyMap<EntryId, string>;
  readonly entryByEvent: ReadonlyMap<string, EntryId>;
  /** Snapshot entries without an event (DebugKit ignored them, or ambiguous), in line order. */
  readonly unmappedEntryIds: readonly EntryId[];
  /** The unmapped entries that could each be the source of an unmatched event. */
  readonly ambiguousEntryIds: readonly EntryId[];
  /** Events without an entry, in event order. */
  readonly unmatchedEventIds: readonly string[];
}

/** What DebugKit keeps of a record, which an event and its line must share. */
interface EventKey {
  readonly messageId: string | undefined;
  readonly messageType: MessageType;
  readonly direction: Direction;
  readonly timestamp: number | null;
}

const MESSAGE_TYPES: Record<TraceRecord["messageType"], MessageType> = {
  CALL: "Call",
  CALLRESULT: "CallResult",
  CALLERROR: "CallError",
};

const DIRECTIONS: Record<TraceRecord["direction"], Direction> = {
  "cp-to-csms": "CS_TO_CSMS",
  "csms-to-cp": "CSMS_TO_CS",
};

/**
 * The key of each record already keyed. Records are immutable and shared by
 * identity across snapshots, so each one is keyed once.
 */
const lineKeys = new WeakMap<TraceRecord, EventKey>();

function lineKey(record: TraceRecord): EventKey {
  let key = lineKeys.get(record);
  if (key === undefined) {
    key = computeLineKey(record);
    lineKeys.set(record, key);
  }
  return key;
}

/**
 * The key DebugKit derives from `record`. A `raw` frame that parses as an
 * OCPP-J frame (DebugKit's own schema) wins over the decomposed fields, as it
 * does in `parseOpenOcppTrace`; otherwise the fields are used. A record
 * without `messageId` is dropped by DebugKit whatever its `raw` holds, so its
 * key keeps no messageId and matches no event.
 */
function computeLineKey(record: TraceRecord): EventKey {
  let messageId = record.messageId;
  let messageType = MESSAGE_TYPES[record.messageType];
  if (record.raw !== undefined && messageId !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(record.raw);
    } catch {
      parsed = undefined;
    }
    const frame = rawOcppMessageSchema.safeParse(parsed);
    if (frame.success) {
      messageId = frame.data[1];
      messageType = classifyMessageType(frame.data);
    }
  }
  return {
    messageId,
    messageType,
    direction: DIRECTIONS[record.direction],
    timestamp: normalizeTimestamp(record.timestamp),
  };
}

function sameKey(key: EventKey, event: Event): boolean {
  return (
    key.messageId === event.messageId &&
    key.messageType === event.messageType &&
    key.direction === event.direction &&
    key.timestamp === event.timestamp
  );
}

/**
 * Aligns DebugKit `events` with the snapshot `lines` they were parsed from.
 *
 * DebugKit numbers its events over the records it accepted (`evt-0001`…) and
 * never reorders them, so an event id is not a line index: records it drops
 * shift every later id. The events therefore form an ordered subsequence of
 * the lines, matched on messageId, message type, direction and timestamp.
 * The earliest and the latest embedding of that subsequence are computed;
 * an event is mapped only where both place it on the same line, which every
 * possible embedding then does. Otherwise it stays unmatched and the lines
 * it could come from stay unmapped: no correlation is guessed. If the events
 * do not embed at all, the whole mapping is dropped with a reason.
 */
export function mapEvents(lines: readonly SnapshotLine[], events: readonly Event[]): EventMapping {
  const keys = lines.map((line) => lineKey(line.record));
  const broken = (reason: string): EventMapping => ({
    status: "broken",
    reason,
    eventByEntry: new Map(),
    entryByEvent: new Map(),
    unmappedEntryIds: lines.map((line) => line.entryId),
    ambiguousEntryIds: [],
    unmatchedEventIds: events.map((event) => event.id),
  });

  const earliest: number[] = [];
  let cursor = 0;
  for (const event of events) {
    while (cursor < keys.length && !sameKey(keys[cursor]!, event)) cursor += 1;
    if (cursor === keys.length) {
      return broken(`DebugKit event ${event.id} matches no snapshot line in order.`);
    }
    earliest.push(cursor);
    cursor += 1;
  }
  const latest: number[] = Array.from({ length: events.length }, () => 0);
  cursor = keys.length - 1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    while (!sameKey(keys[cursor]!, event)) cursor -= 1;
    latest[index] = cursor;
    cursor -= 1;
  }

  const eventByEntry = new Map<EntryId, string>();
  const entryByEvent = new Map<string, EntryId>();
  const ambiguous = new Set<number>();
  const unmatchedEventIds: string[] = [];
  events.forEach((event, index) => {
    const first = earliest[index]!;
    const last = latest[index]!;
    if (first === last) {
      const entryId = lines[first]!.entryId;
      eventByEntry.set(entryId, event.id);
      entryByEvent.set(event.id, entryId);
      return;
    }
    unmatchedEventIds.push(event.id);
    for (let line = first; line <= last; line += 1) {
      if (sameKey(keys[line]!, event)) ambiguous.add(line);
    }
  });

  const unmappedEntryIds: EntryId[] = [];
  const ambiguousEntryIds: EntryId[] = [];
  lines.forEach((line, index) => {
    if (eventByEntry.has(line.entryId)) return;
    unmappedEntryIds.push(line.entryId);
    if (ambiguous.has(index)) ambiguousEntryIds.push(line.entryId);
  });
  return {
    status: "aligned",
    eventByEntry,
    entryByEvent,
    unmappedEntryIds,
    ambiguousEntryIds,
    unmatchedEventIds,
  };
}
