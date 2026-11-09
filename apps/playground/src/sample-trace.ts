import {
  createCorrelator,
  createViewerStore,
  type ColumnDefinition,
  type Correlator,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

/** A short charging session: calls, responses, an error, a gap and an unparsed frame. */
const ENTRIES: readonly ViewerEntry[] = [
  {
    kind: "trace",
    id: "boot",
    metadata: { chargePointId: "CP-1", custom: { site: "north" } },
    record: {
      schemaVersion: "1.1",
      timestamp: "2026-11-09T08:00:00.000Z",
      transport: "json",
      direction: "cp-to-csms",
      ocppVersion: "1.6",
      chargePointId: "CP-1",
      messageType: "CALL",
      messageId: "m-1",
      action: "BootNotification",
      payload: { chargePointVendor: "Acme", chargePointModel: "AC-22" },
    },
  },
  {
    kind: "trace",
    id: "boot-result",
    metadata: { chargePointId: "CP-1", custom: { site: "north" } },
    record: {
      schemaVersion: "1.1",
      timestamp: "2026-11-09T08:00:00.120Z",
      transport: "json",
      direction: "csms-to-cp",
      ocppVersion: "1.6",
      chargePointId: "CP-1",
      messageType: "CALLRESULT",
      messageId: "m-1",
      payload: { status: "Accepted", currentTime: "2026-11-09T08:00:00Z", interval: 300 },
    },
  },
  {
    kind: "trace",
    id: "authorize",
    metadata: { chargePointId: "CP-1", custom: { site: "north" } },
    record: {
      schemaVersion: "1.1",
      timestamp: "2026-11-09T08:02:10.000Z",
      transport: "json",
      direction: "cp-to-csms",
      ocppVersion: "1.6",
      chargePointId: "CP-1",
      messageType: "CALL",
      messageId: "m-2",
      action: "Authorize",
      payload: { idTag: "TAG-0042" },
    },
  },
  {
    kind: "trace",
    id: "authorize-error",
    metadata: { chargePointId: "CP-1", custom: { site: "north" } },
    record: {
      schemaVersion: "1.1",
      timestamp: "2026-11-09T08:02:10.300Z",
      transport: "json",
      direction: "csms-to-cp",
      ocppVersion: "1.6",
      chargePointId: "CP-1",
      messageType: "CALLERROR",
      messageId: "m-2",
      error: { code: "InternalError", description: "The authorization backend timed out" },
    },
  },
  {
    kind: "gap",
    id: "gap-1",
    reason: "disconnected",
    timestamp: "2026-11-09T08:05:00.000Z",
    missedCount: 3,
  },
  {
    kind: "unparsed",
    id: "garbled",
    raw: '[2,"m-3","Heartbeat",{',
    reason: "Unexpected end of JSON input",
    timestamp: "2026-11-09T08:09:00.000Z",
    direction: "cp-to-csms",
    transport: "json",
    metadata: { chargePointId: "CP-2", custom: { site: "south" } },
  },
  {
    kind: "trace",
    id: "heartbeat",
    metadata: { chargePointId: "CP-2", custom: { site: "south" } },
    record: {
      schemaVersion: "1.1",
      timestamp: "2026-11-09T08:10:00.000Z",
      transport: "json",
      direction: "cp-to-csms",
      ocppVersion: "1.6",
      chargePointId: "CP-2",
      messageType: "CALL",
      messageId: "m-4",
      action: "Heartbeat",
      payload: {},
    },
  },
  {
    kind: "trace",
    id: "heartbeat-result",
    metadata: { chargePointId: "CP-2", custom: { site: "south" } },
    record: {
      schemaVersion: "1.1",
      timestamp: "2026-11-09T08:10:00.050Z",
      transport: "json",
      direction: "csms-to-cp",
      ocppVersion: "1.6",
      chargePointId: "CP-2",
      messageType: "CALLRESULT",
      messageId: "m-4",
      payload: { currentTime: "2026-11-09T08:10:00Z" },
    },
  },
];

/** An in-memory trace, with a correlator connected to its store. */
export interface SampleTrace {
  readonly store: ViewerStore;
  readonly correlator: Correlator;
}

/** A fresh store per example, so two examples never share state. */
export function createSampleTrace(): SampleTrace {
  const store = createViewerStore();
  const correlator = createCorrelator();
  correlator.connect(store);
  store.load(ENTRIES);
  return { store, correlator };
}

/** The producer's `site`, kept in `metadata.custom`. */
export function siteOf(entry: ViewerEntry): string | undefined {
  const site = entry.metadata?.custom?.["site"];
  return typeof site === "string" ? site : undefined;
}

/** A custom metadata column, labelled by the host. */
export function siteColumn(label: string): ColumnDefinition {
  return { id: "site", label, value: siteOf };
}

/** Whether `entry` is a CALLERROR. */
export function isCallError(entry: ViewerEntry): boolean {
  return entry.kind === "trace" && entry.record.messageType === "CALLERROR";
}
