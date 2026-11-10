/**
 * Maps a gateway trace document to a viewer entry. Pure and DOM-free.
 *
 * A `kind: "trace"` document becomes a `TraceEntry` whose `record` is the
 * document's record itself, never copied or changed, so an export writes
 * exactly what the gateway recorded. A `kind: "frame"` document becomes an
 * `UnparsedEntry`: it is never turned into a record. The gateway's context
 * (tenant, session, source, deliveries) goes into `metadata`, beside the
 * record, as ADR 0001 requires.
 */
import type { TraceEntry, ViewerEntry } from "@open-ocpp-trace/viewer-standalone";

import type { GatewayMeta, WireDelivery, WireTraceDocument } from "./wire.ts";

type EntryMetadata = NonNullable<TraceEntry["metadata"]>;
/** One delivery of an entry, as the viewer reads it. */
export type EntryDelivery = NonNullable<EntryMetadata["deliveries"]>[number];
type EntrySource = NonNullable<EntryMetadata["source"]>;

/** Maps one wire delivery to an entry delivery, keeping only the known fields. */
export function toEntryDelivery(delivery: WireDelivery): EntryDelivery {
  return {
    target: delivery.target,
    ...(delivery.role !== undefined && { role: delivery.role }),
    status: delivery.status,
    ...(delivery.reason !== undefined && { reason: delivery.reason }),
    ...(delivery.updatedAt !== undefined && { updatedAt: delivery.updatedAt }),
  };
}

function gatewayMeta(doc: WireTraceDocument): GatewayMeta | undefined {
  const meta: unknown = doc.kind === "trace" ? doc.trace.meta : doc.frame.meta;
  if (typeof meta !== "object" || meta === null) return undefined;
  const gateway: unknown = (meta as { gateway?: unknown }).gateway;
  return typeof gateway === "object" && gateway !== null ? (gateway as GatewayMeta) : undefined;
}

/**
 * The peer that sent the frame, as `"<type>:<id>"` so that a charge point
 * and a CSMS with the same name stay apart. The label is display text only.
 */
function entrySource(meta: GatewayMeta | undefined): EntrySource | undefined {
  const source: unknown = meta?.source;
  if (typeof source !== "object" || source === null) return undefined;
  const { type, id, role } = source as { type?: unknown; id?: unknown; role?: unknown };
  if (typeof type !== "string" || typeof id !== "string") return undefined;
  if (type === "charge-point") return { id: `${type}:${id}`, label: `Charge point ${id}` };
  if (type === "csms") {
    const suffix = typeof role === "string" ? ` (${role})` : "";
    return { id: `${type}:${id}`, label: `CSMS ${id}${suffix}` };
  }
  return { id: `${type}:${id}` };
}

/**
 * The gateway fields the viewer has no property for, kept in
 * `metadata.custom`: the per-session sequence number, the correlation the
 * gateway computed, and the `ignored` and `binary` flags.
 */
function custom(doc: WireTraceDocument, meta: GatewayMeta | undefined): Record<string, unknown> {
  return {
    seq: doc.seq,
    ...(meta?.correlation !== undefined && { correlation: meta.correlation }),
    ...(meta?.ignored === true && { ignored: true }),
    ...(meta?.binary === true && { binary: true }),
  };
}

/** The viewer metadata of a document: its routing context, never inside the record. */
export function gatewayMetadata(doc: WireTraceDocument): EntryMetadata {
  const meta = gatewayMeta(doc);
  const source = entrySource(meta);
  return {
    ...(doc.tenantId !== null && { tenant: doc.tenantId }),
    chargePointId: doc.chargePointId,
    sessionId: doc.sessionId,
    // A gateway session is one charge point WebSocket connection: the scope
    // in which OCPP message ids are unique (ADR 0002).
    conversationId: doc.sessionId,
    ...(source !== undefined && { source }),
    deliveries: doc.deliveries.map(toEntryDelivery),
    custom: custom(doc, meta),
  };
}

/** Maps one gateway trace document to a viewer entry. */
export function gatewayEntry(doc: WireTraceDocument): ViewerEntry {
  const metadata = gatewayMetadata(doc);
  if (doc.kind === "trace") {
    return { kind: "trace", id: doc.id, receivedAt: doc.receivedAt, record: doc.trace, metadata };
  }
  const { frame } = doc;
  return {
    kind: "unparsed",
    id: doc.id,
    receivedAt: doc.receivedAt,
    raw: frame.raw,
    reason: frame.reason,
    ...(frame.timestamp !== undefined && { timestamp: frame.timestamp }),
    ...(frame.direction !== undefined && { direction: frame.direction }),
    transport: "json",
    metadata,
  };
}
