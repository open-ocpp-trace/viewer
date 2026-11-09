/**
 * Compile-only sketch of an OCPP Gateway adapter, checking that the entry
 * contract can carry the gateway's routing outcomes without touching the
 * record. The input types are local and minimal on purpose: the viewer never
 * imports gateway code, and the wire shapes below are assumptions of this
 * sketch, not the gateway's API.
 */
import type { TraceRecord } from "@open-ocpp-trace/core";
import type {
  EntryDelivery,
  EntryUpdate,
  Unsubscribe,
  ViewerAdapter,
  ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

/** One delivery outcome as the gateway would send it, dates as RFC 3339. */
export interface GatewayDelivery {
  target: string;
  role: "primary" | "secondary" | "charge-point";
  status: "queued" | "submitted" | "written" | "failed" | "dropped";
  reason?: string;
  updatedAt: string;
}

interface GatewayEnvelopeBase {
  id: string;
  tenantId: string | null;
  sessionId: string;
  chargePointId: string;
  receivedAt: string;
  /** Full list, one per destination, sent once with the envelope. */
  deliveries: GatewayDelivery[];
}

/** A received frame: a conformant record or a raw frame with a reason. */
export type GatewayEnvelope = GatewayEnvelopeBase &
  (
    | { kind: "trace"; trace: TraceRecord }
    | {
        kind: "frame";
        frame: {
          timestamp: string;
          direction: TraceRecord["direction"];
          raw: string;
          reason: string;
        };
      }
  );

/**
 * A newer state of one delivery of an envelope already sent. The delivery
 * carries its `target`, which is all the viewer needs to merge it.
 */
export interface GatewayDeliveryChange {
  id: string;
  delivery: GatewayDelivery;
}

/** Maps one envelope to a viewer entry, the record wrapped as is. */
export function gatewayEntry(envelope: GatewayEnvelope): ViewerEntry {
  const metadata = {
    ...(envelope.tenantId !== null && { tenant: envelope.tenantId }),
    chargePointId: envelope.chargePointId,
    sessionId: envelope.sessionId,
    source: { id: "gateway", label: "OCPP Gateway" },
    deliveries: envelope.deliveries.map(toEntryDelivery),
  };
  if (envelope.kind === "trace") {
    return {
      kind: "trace",
      id: envelope.id,
      receivedAt: envelope.receivedAt,
      record: envelope.trace,
      metadata,
    };
  }
  return {
    kind: "unparsed",
    id: envelope.id,
    receivedAt: envelope.receivedAt,
    raw: envelope.frame.raw,
    reason: envelope.frame.reason,
    timestamp: envelope.frame.timestamp,
    direction: envelope.frame.direction,
    transport: "json",
    metadata,
  };
}

function toEntryDelivery(delivery: GatewayDelivery): EntryDelivery {
  return {
    target: delivery.target,
    role: delivery.role,
    status: delivery.status,
    ...(delivery.reason !== undefined && { reason: delivery.reason }),
    updatedAt: delivery.updatedAt,
  };
}

/** A live gateway adapter fed by whatever transport the host uses. */
export interface GatewayAdapter {
  adapter: ViewerAdapter;
  receive(envelope: GatewayEnvelope): void;
  deliveryChanged(change: GatewayDeliveryChange): void;
  /** The transport reconnected after a loss: frames may have been missed. */
  reconnected(at: string, missedCount?: number): void;
}

export function createGatewayAdapter(): GatewayAdapter {
  const listeners = new Set<(updates: readonly EntryUpdate[]) => void>();
  let gaps = 0;
  const emit = (updates: readonly EntryUpdate[]): void => {
    for (const listener of listeners) listener(updates);
  };

  return {
    adapter: {
      snapshot: () => Promise.resolve([]),
      subscribe(listener): Unsubscribe {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    receive(envelope) {
      emit([{ type: "add", entry: gatewayEntry(envelope) }]);
    },
    deliveryChanged({ id, delivery }) {
      // No revision: a counter stamped here would only restate arrival order.
      // Keeping delivery statuses forward-only (queued, submitted, then a
      // final status) is this adapter's job, not the viewer's.
      emit([{ type: "update", id, metadata: { deliveries: [toEntryDelivery(delivery)] } }]);
    },
    reconnected(at, missedCount) {
      emit([
        {
          type: "add",
          entry: {
            kind: "gap",
            id: `gateway-gap-${gaps++}`,
            reason: "disconnected",
            timestamp: at,
            ...(missedCount !== undefined && { missedCount }),
          },
        },
      ]);
    },
  };
}
