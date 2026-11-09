import type { TraceRecord } from "@open-ocpp-trace/core";

import type {
  EntryUpdate,
  GapEntry,
  TraceEntry,
  UnparsedEntry,
  ViewerEntry,
  ViewerStore,
  ViewerStoreChange,
} from "@open-ocpp-trace/viewer-core";

export function traceRecord(messageId: string): TraceRecord {
  return {
    schemaVersion: "1.1",
    timestamp: "2026-11-09T10:00:00.000Z",
    transport: "json",
    direction: "cp-to-csms",
    chargePointId: "CP-1",
    messageType: "CALL",
    messageId,
    action: "Heartbeat",
    payload: {},
    raw: `[2,"${messageId}","Heartbeat",{}]`,
  };
}

export function trace(id: string, extra: Partial<TraceEntry> = {}): TraceEntry {
  return { kind: "trace", id, record: traceRecord(id), ...extra };
}

export function unparsed(id: string, raw = "not json"): UnparsedEntry {
  return { kind: "unparsed", id, raw, reason: "invalid JSON" };
}

export function gap(id: string): GapEntry {
  return { kind: "gap", id, reason: "disconnected" };
}

export function add(entry: ViewerEntry): EntryUpdate {
  return { type: "add", entry };
}

export function adds(...ids: string[]): EntryUpdate[] {
  return ids.map((id) => add(trace(id)));
}

export function ids(store: ViewerStore): string[] {
  return store.toArray().map((entry) => entry.id);
}

/**
 * Keeps a copy of the listed ids by applying each notified change the way a
 * consumer would: drop `evicted.length` from the front (after dropping all if
 * `cleared`), then append `added`.
 */
export function mirror(store: ViewerStore): { ids: string[]; changes: ViewerStoreChange[] } {
  const state = { ids: ids(store), changes: [] as ViewerStoreChange[] };
  store.subscribe((change) => {
    state.changes.push(change);
    if (change.cleared) state.ids = [];
    const front = state.ids.slice(0, change.evicted.length);
    if (front.join("\n") !== change.evicted.join("\n")) {
      throw new Error(`evicted ${change.evicted.join(",")} is not the front ${front.join(",")}`);
    }
    state.ids = [...state.ids.slice(change.evicted.length), ...change.added];
  });
  return state;
}

/** Deeply freezes a test value so any mutation by the store throws. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}
