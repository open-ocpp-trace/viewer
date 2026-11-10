/**
 * The OCPP Gateway viewer stream as this example reads it: minimal local
 * types of the server-sent events and a decoder that checks their shape.
 *
 * The viewer never imports gateway code, so these types restate only what
 * the adapter reads. Dates are RFC 3339 strings, as the gateway serializes
 * them. Everything decoded here is untrusted: the decoder checks shapes, it
 * never trusts that a string is what its name says.
 */
import type { TraceEntry } from "@open-ocpp-trace/viewer-standalone";

/** The record the gateway sends: an Open OCPP Trace record, kept as is. */
export type GatewayRecord = TraceEntry["record"];

/** The direction of a frame, typed from the record. */
export type GatewayDirection = GatewayRecord["direction"];

/** First event of each connection. A new `startedAt` means the gateway restarted. */
export interface Hello {
  readonly serverTime: string;
  readonly startedAt: string;
  readonly maxBufferedMessages: number;
}

/** The peer that sent a frame through the gateway. */
export type TraceSource =
  | { readonly type: "charge-point"; readonly id: string }
  | { readonly type: "csms"; readonly id: string; readonly role: string };

/** The routing context the gateway puts in `record.meta.gateway`. */
export interface GatewayMeta {
  readonly traceId?: string;
  readonly tenantId?: string | null;
  readonly sessionId?: string;
  readonly seq?: number;
  readonly source?: TraceSource;
  readonly ignored?: true;
  readonly correlation?: { readonly callTraceId: string; readonly action: string };
  readonly binary?: true;
}

/** One routing outcome of a frame, aligned with the frame's destinations. */
export interface WireDelivery {
  readonly target: string;
  readonly role: string;
  readonly status: string;
  readonly reason?: string;
  readonly updatedAt: string;
}

/** A frame the gateway could not store as a conformant record. */
export interface WireFrame {
  readonly timestamp: string;
  readonly ocppVersion?: string;
  readonly chargePointId: string;
  readonly direction?: GatewayDirection;
  readonly raw: string;
  readonly reason: string;
  readonly meta?: { readonly gateway?: GatewayMeta };
}

interface WireDocumentBase {
  readonly id: string;
  readonly tenantId: string | null;
  readonly sessionId: string;
  readonly chargePointId: string;
  readonly seq: number;
  readonly receivedAt: string;
  readonly deliveries: readonly WireDelivery[];
}

/** One `trace` event: a record or an unparsed frame, with its deliveries. */
export type WireTraceDocument = WireDocumentBase &
  (
    | { readonly kind: "trace"; readonly trace: GatewayRecord }
    | { readonly kind: "frame"; readonly frame: WireFrame }
  );

/** A newer state of the delivery at `index` of the document `id`. */
export interface DeliveryUpdate {
  readonly id: string;
  readonly index: number;
  readonly delivery: WireDelivery;
}

/** One decoded event of the stream. */
export type StreamEvent =
  | { readonly type: "hello"; readonly hello: Hello }
  | { readonly type: "trace"; readonly doc: WireTraceDocument }
  | { readonly type: "delivery"; readonly update: DeliveryUpdate }
  | { readonly type: "gap"; readonly dropped: number };

/**
 * The largest `VIEWER_MAX_BUFFERED_MESSAGES` the gateway accepts. A hello
 * beyond it is rejected: it sizes the viewer and the adapter's state.
 */
export const MAX_BUFFERED_MESSAGES_LIMIT = 100_000;

type Obj = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isDelivery(value: unknown): value is WireDelivery {
  return (
    isObject(value) &&
    isString(value["target"]) &&
    isString(value["status"]) &&
    (value["role"] === undefined || isString(value["role"])) &&
    (value["reason"] === undefined || isString(value["reason"])) &&
    (value["updatedAt"] === undefined || isString(value["updatedAt"]))
  );
}

function isHello(value: unknown): value is Hello {
  return (
    isObject(value) &&
    isString(value["serverTime"]) &&
    isString(value["startedAt"]) &&
    isCount(value["maxBufferedMessages"]) &&
    value["maxBufferedMessages"] >= 1 &&
    value["maxBufferedMessages"] <= MAX_BUFFERED_MESSAGES_LIMIT
  );
}

function isFrame(value: unknown): value is WireFrame {
  return (
    isObject(value) &&
    isString(value["raw"]) &&
    isString(value["reason"]) &&
    (value["timestamp"] === undefined || isString(value["timestamp"])) &&
    (value["direction"] === undefined ||
      value["direction"] === "cp-to-csms" ||
      value["direction"] === "csms-to-cp")
  );
}

function isDocument(value: unknown): value is WireTraceDocument {
  if (
    !isObject(value) ||
    !isString(value["id"]) ||
    !(value["tenantId"] === null || isString(value["tenantId"])) ||
    !isString(value["sessionId"]) ||
    !isString(value["chargePointId"]) ||
    !isString(value["receivedAt"]) ||
    !Array.isArray(value["deliveries"]) ||
    !value["deliveries"].every(isDelivery)
  ) {
    return false;
  }
  if (value["kind"] === "trace") return isObject(value["trace"]);
  if (value["kind"] === "frame") return isFrame(value["frame"]);
  return false;
}

function isDeliveryUpdate(value: unknown): value is DeliveryUpdate {
  return (
    isObject(value) &&
    isString(value["id"]) &&
    typeof value["index"] === "number" &&
    isDelivery(value["delivery"])
  );
}

/**
 * Decodes one server-sent event, or returns `null` for an unknown event
 * name, malformed JSON or a payload of the wrong shape.
 */
export function decodeEvent(name: string, data: string): StreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  switch (name) {
    case "hello":
      return isHello(value) ? { type: "hello", hello: value } : null;
    case "trace":
      return isDocument(value) ? { type: "trace", doc: value } : null;
    case "delivery":
      return isDeliveryUpdate(value) ? { type: "delivery", update: value } : null;
    case "gap":
      return isObject(value) && isCount(value["dropped"])
        ? { type: "gap", dropped: value["dropped"] }
        : null;
    default:
      return null;
  }
}
