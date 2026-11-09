import { parseRecord } from "@open-ocpp-trace/jsonl";
import type { EntryUpdate, TraceEntry, ViewerEntry } from "@open-ocpp-trace/viewer-core";

/** A trace entry whose record the SDK reader parsed from a JSONL line. */
export function sdkEntry(id: string, fields: Record<string, unknown> = {}): TraceEntry {
  const line = JSON.stringify({
    schemaVersion: "1.1",
    timestamp: "2026-11-09T10:00:00.000Z",
    ocppVersion: "1.6",
    transport: "json",
    chargePointId: "CP-1",
    direction: "cp-to-csms",
    messageType: "CALL",
    messageId: `m-${id}`,
    action: "Heartbeat",
    payload: {},
    ...fields,
  });
  const result = parseRecord(line);
  if (!result.ok) throw result.error;
  return { kind: "trace", id, record: result.record };
}

/** An `add` update for `entry`. */
export function add(entry: ViewerEntry): EntryUpdate {
  return { type: "add", entry };
}
