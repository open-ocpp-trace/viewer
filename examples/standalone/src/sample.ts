import type {
  EntryUpdate,
  Unsubscribe,
  ViewerAdapter,
  ViewerEntry,
} from "@open-ocpp-trace/viewer-standalone";

/** A charge point booting and starting a heartbeat. */
export const SNAPSHOT: readonly ViewerEntry[] = [
  {
    kind: "trace",
    id: "boot",
    metadata: { chargePointId: "CP-1" },
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
    metadata: { chargePointId: "CP-1" },
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
];

/** The n-th heartbeat call of CP-1, as a producer would send it. */
export function heartbeat(n: number): ViewerEntry {
  const seconds = String(n * 5).padStart(2, "0");
  return {
    kind: "trace",
    id: `heartbeat-${n}`,
    metadata: { chargePointId: "CP-1" },
    record: {
      schemaVersion: "1.1",
      timestamp: `2026-11-09T08:01:${seconds}.000Z`,
      transport: "json",
      direction: "cp-to-csms",
      ocppVersion: "1.6",
      chargePointId: "CP-1",
      messageType: "CALL",
      messageId: `hb-${n}`,
      action: "Heartbeat",
      payload: {},
    },
  };
}

/** Tags the boot entry with a tenant, as a producer enriching an entry later. */
export const TENANT_UPDATE: EntryUpdate = {
  type: "update",
  id: "boot",
  metadata: { tenant: "acme" },
};

/**
 * An in-memory producer: `snapshot()` returns {@link SNAPSHOT} and
 * `push()` sends updates to the subscribed viewer. A real host would read
 * them from its own transport (WebSocket, SSE, polling…).
 */
export interface MemoryAdapter extends ViewerAdapter {
  push(updates: readonly EntryUpdate[]): void;
  /** Whether a viewer is subscribed. */
  readonly connected: boolean;
}

export function memoryAdapter(): MemoryAdapter {
  let listener: ((updates: readonly EntryUpdate[]) => void) | undefined;
  return {
    snapshot: () => SNAPSHOT,
    subscribe(next): Unsubscribe {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    push(updates) {
      listener?.(updates);
    },
    get connected() {
      return listener !== undefined;
    },
  };
}
