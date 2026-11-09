import type { TraceRecord } from "@open-ocpp-trace/core";

import type {
  EntryMetadata,
  FilterFieldDefinition,
  GapEntry,
  TraceEntry,
  UnparsedEntry,
  ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { compileFilter, type TraceFilter } from "../src/filter-model.ts";
import { matchesFilter, type MatchContext } from "../src/filter-match.ts";
import { deepFreeze } from "./store-fixtures.ts";

/** A deeply frozen trace entry built from record and metadata overrides. */
export function record(
  id: string,
  fields: Record<string, unknown> = {},
  metadata?: EntryMetadata,
  extra: Partial<TraceEntry> = {},
): TraceEntry {
  const base = {
    schemaVersion: "1.1",
    timestamp: "2026-11-09T10:00:00.000Z",
    transport: "json",
    direction: "cp-to-csms",
    messageType: "CALL",
    messageId: `m-${id}`,
    action: "Heartbeat",
    payload: {},
  };
  return deepFreeze({
    kind: "trace",
    id,
    record: { ...base, ...fields } as unknown as TraceRecord,
    ...(metadata !== undefined && { metadata }),
    ...extra,
  });
}

/** Simulator-like stream: one plain charge point, an unparsed frame, a gap. */
export const simulator = {
  boot: record("s1", {
    chargePointId: "CP-1",
    connectorId: 0,
    ocppVersion: "1.6",
    action: "BootNotification",
    timestamp: "2026-11-09T10:00:00.000Z",
  }),
  status: record("s2", {
    chargePointId: "CP-1",
    connectorId: 1,
    ocppVersion: "1.6",
    action: "StatusNotification",
    timestamp: "2026-11-09T10:00:05.000Z",
  }),
  result: record("s3", {
    chargePointId: "CP-1",
    ocppVersion: "1.6",
    direction: "csms-to-cp",
    messageType: "CALLRESULT",
    messageId: "m-s2",
    action: undefined,
    timestamp: "2026-11-09T10:00:06.000Z",
  }),
  garbage: deepFreeze<UnparsedEntry>({
    kind: "unparsed",
    id: "s4",
    raw: "not json",
    reason: "invalid JSON",
    direction: "cp-to-csms",
    timestamp: "2026-11-09T10:00:07.000Z",
  }),
  gap: deepFreeze<GapEntry>({ kind: "gap", id: "s5", reason: "disconnected" }),
};

/** Gateway-like entries: tenant, source, sessions and deliveries in metadata. */
export const gateway = {
  primary: record(
    "g1",
    { chargePointId: undefined, ocppVersion: "2.0.1", action: "Authorize" },
    {
      tenant: "acme",
      chargePointId: "CP-7",
      sessionId: "sess-1",
      conversationId: "conv-1",
      source: { id: "gw-eu", label: "Gateway EU" },
      deliveries: [
        { target: "csms-a", role: "primary", status: "written" },
        { target: "csms-b", role: "secondary", status: "failed" },
      ],
    },
  ),
  queued: record(
    "g2",
    { chargePointId: "CP-8", ocppVersion: "2.0.1", action: "Heartbeat" },
    {
      tenant: "globex",
      chargePointId: "CP-ignored",
      sessionId: "sess-2",
      source: { id: "gw-us" },
      deliveries: [{ target: "csms-a", status: "queued" }],
    },
  ),
};

export const all: readonly ViewerEntry[] = [...Object.values(simulator), ...Object.values(gateway)];

export function context(
  fields: readonly FilterFieldDefinition[] = [],
  correlator?: MatchContext["correlator"],
): MatchContext {
  return {
    fields: new Map(fields.map((field) => [field.id, field])),
    ...(correlator !== undefined && { correlator }),
  };
}

/** Ids of `entries` matching `filter`. */
export function select(
  filter: TraceFilter,
  entries: readonly ViewerEntry[] = all,
  ctx: MatchContext = context(),
  payloadSearch = false,
): string[] {
  const compiled = compileFilter(filter, ctx.fields, payloadSearch);
  return entries.filter((entry) => matchesFilter(entry, compiled, ctx)).map((entry) => entry.id);
}
