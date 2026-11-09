import type { TraceRecord } from "@open-ocpp-trace/core";

/**
 * Identity of a viewer entry, unique within one viewer. Adapters build it from
 * their own keys (a gateway trace id, a simulator line counter, …); the viewer
 * only compares it.
 */
export type EntryId = string;

/**
 * Known delivery statuses, mirroring the OCPP Gateway's vocabulary, plus any
 * other string a producer may send.
 *
 * - `queued`: held by the producer while the link is not open;
 * - `submitted`: handed to the transport;
 * - `written`: written to the socket, which is not an acknowledgement;
 * - `failed`: the transport reported an error;
 * - `dropped`: discarded by the producer (see {@link EntryDelivery.reason}).
 */
export type EntryDeliveryStatus =
  | "queued"
  | "submitted"
  | "written"
  | "failed"
  | "dropped"
  | (string & {});

/** Known roles of a delivery target, plus any other string. */
export type EntryDeliveryRole = "primary" | "secondary" | "charge-point" | (string & {});

/**
 * The latest known outcome of routing an entry's frame to one target. A
 * delivery in a patch replaces the one with the same `target` whole, so it
 * carries `role`, `updatedAt` and `reason` again.
 */
export interface EntryDelivery {
  /**
   * The peer the frame was routed to, unique within an entry; deliveries are
   * merged per target, and a duplicate target in one list keeps the last one.
   */
  readonly target: string;
  readonly role?: EntryDeliveryRole;
  readonly status: EntryDeliveryStatus;
  /** Why the frame was dropped or failed. */
  readonly reason?: string;
  /** RFC 3339 date-time of this status. */
  readonly updatedAt?: string;
}

/** The producer an entry came from. */
export interface EntrySource {
  readonly id: string;
  readonly label?: string;
}

/**
 * Producer context kept beside an entry, never inside its record.
 *
 * Precedence: a field present on the {@link TraceRecord} wins, and metadata
 * only supplies context the record lacks. The effective charge point of a
 * trace entry is `entry.record.chargePointId ?? entry.metadata?.chargePointId`.
 */
export interface EntryMetadata {
  readonly tenant?: string;
  readonly chargePointId?: string;
  readonly sessionId?: string;
  readonly conversationId?: string;
  readonly source?: EntrySource;
  readonly deliveries?: readonly EntryDelivery[];
  /** Producer-specific fields, opaque to the viewer. */
  readonly custom?: Readonly<Record<string, unknown>>;
}

interface EntryBase {
  readonly id: EntryId;
  /** RFC 3339 date-time at which the viewer or its adapter received the entry. */
  readonly receivedAt?: string;
  readonly metadata?: EntryMetadata;
}

/**
 * A conformant Open OCPP Trace record. The record is source-owned: the viewer
 * never mutates or copies it, and its `timestamp` is the entry's timestamp.
 */
export interface TraceEntry extends EntryBase {
  readonly kind: "trace";
  readonly record: Readonly<TraceRecord>;
}

/**
 * A received frame that is not a conformant record (not OCPP-J, invalid
 * JSON, unknown message type, …), kept raw without claiming conformance.
 */
export interface UnparsedEntry extends EntryBase {
  readonly kind: "unparsed";
  /** The frame exactly as received. */
  readonly raw: string;
  /** Why the frame is not a record, in the producer's words. */
  readonly reason: string;
  /** RFC 3339 date-time of the frame, when known. */
  readonly timestamp?: string;
  readonly direction?: TraceRecord["direction"];
  readonly transport?: TraceRecord["transport"];
}

/** Known causes of a gap, plus any other string. */
export type GapReason = "disconnected" | "dropped" | "unknown" | (string & {});

/**
 * A point in the stream where entries may be missing, such as a connection
 * loss reported by the adapter that owns the transport.
 */
export interface GapEntry extends EntryBase {
  readonly kind: "gap";
  readonly reason: GapReason;
  /** RFC 3339 date-time of the gap, when known. */
  readonly timestamp?: string;
  /** Number of entries known to be missing, when the producer counts them. */
  readonly missedCount?: number;
}

/** One row of the viewer, discriminated by `kind`. */
export type ViewerEntry = TraceEntry | UnparsedEntry | GapEntry;
