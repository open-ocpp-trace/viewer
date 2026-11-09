import type { TraceRecord } from "@open-ocpp-trace/core";

import {
  createCorrelator,
  createViewerStore,
  type CorrelationScope,
  type Correlator,
  type TraceEntry,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { deepFreeze } from "./store-fixtures.ts";

type MessageType = TraceRecord["messageType"];
type Direction = TraceRecord["direction"];

export interface FrameOptions {
  /** Default: `cp-to-csms` for a CALL, `csms-to-cp` for a response. */
  readonly direction?: Direction;
  /** Record charge point. Default `CP-1`; `null` leaves it out. */
  readonly chargePointId?: string | null;
  readonly sessionId?: string;
  readonly metadataChargePointId?: string;
  /** Default `Heartbeat` for a CALL, none for a response. */
  readonly action?: string;
}

/** A deeply frozen trace entry, so any mutation by the correlator throws. */
export function frame(
  id: string,
  messageType: MessageType,
  messageId: string,
  options: FrameOptions = {},
): TraceEntry {
  const direction = options.direction ?? (messageType === "CALL" ? "cp-to-csms" : "csms-to-cp");
  const chargePointId = options.chargePointId === undefined ? "CP-1" : options.chargePointId;
  const action = options.action ?? (messageType === "CALL" ? "Heartbeat" : undefined);
  const record = {
    schemaVersion: "1.1",
    timestamp: "2026-11-09T10:00:00.000Z",
    transport: "json",
    direction,
    messageType,
    messageId,
    payload: {},
    ...(chargePointId !== null && { chargePointId }),
    ...(action !== undefined && { action }),
    ...(messageType === "CALLERROR" && { error: { code: "InternalError" } }),
  } as TraceRecord;
  const metadata = {
    ...(options.sessionId !== undefined && { sessionId: options.sessionId }),
    ...(options.metadataChargePointId !== undefined && {
      chargePointId: options.metadataChargePointId,
    }),
  };
  return deepFreeze({
    kind: "trace",
    id,
    record,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });
}

export function call(id: string, messageId: string, options?: FrameOptions): TraceEntry {
  return frame(id, "CALL", messageId, options);
}

export function result(id: string, messageId: string, options?: FrameOptions): TraceEntry {
  return frame(id, "CALLRESULT", messageId, options);
}

export function error(id: string, messageId: string, options?: FrameOptions): TraceEntry {
  return frame(id, "CALLERROR", messageId, options);
}

/** Loads `entries` into a new store and connects a new correlator to it. */
export function correlate(
  entries: readonly ViewerEntry[],
  scope?: CorrelationScope,
): { correlator: Correlator; store: ViewerStore } {
  const store = createViewerStore();
  store.load(entries);
  const correlator = createCorrelator(scope === undefined ? undefined : { scope });
  correlator.connect(store);
  return { correlator, store };
}
