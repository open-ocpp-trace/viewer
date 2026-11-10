/**
 * The gateway adapter's state: decodes the stream's events, maps documents
 * to entries, applies delivery updates and reports gaps, as batches of
 * `EntryUpdate`s for one viewer. DOM-free and transport-free: the page feeds
 * it the events its transport reads.
 */
import type {
  EntryUpdate,
  GapEntry,
  Unsubscribe,
  ViewerAdapter,
} from "@open-ocpp-trace/viewer-standalone";

import { type EntryDelivery, gatewayEntry, toEntryDelivery } from "./mapping.ts";
import { decodeEvent, type DeliveryUpdate, type Hello, type WireTraceDocument } from "./wire.ts";

/**
 * The gateway's delivery status order: an update is applied only when it
 * moves a delivery strictly forward. `written`, `failed` and `dropped` are
 * final. An unknown status has no rank and is ignored.
 */
export const DELIVERY_STATUS_RANK: ReadonlyMap<string, number> = new Map([
  ["queued", 0],
  ["submitted", 1],
  ["written", 2],
  ["failed", 2],
  ["dropped", 2],
]);

/** The gateway's default `VIEWER_MAX_BUFFERED_MESSAGES`, used until the first hello. */
export const DEFAULT_MAX_BUFFERED_MESSAGES = 1000;

/** What a `hello` event says about the connection it opens. */
export interface HelloOutcome {
  readonly hello: Hello;
  /** The first hello this feed received. */
  readonly first: boolean;
  /** A later hello: the stream was lost and is back. */
  readonly reconnected: boolean;
  /** A later hello whose `startedAt` changed: the gateway restarted. */
  readonly restarted: boolean;
}

/** Counters of a feed, cumulative. */
export interface GatewayFeedCounters {
  /** Trace documents received, records and frames. */
  readonly received: number;
  /** Delivery updates applied. */
  readonly deliveryUpdates: number;
  /** Delivery updates ignored: unknown id, index out of range, unknown or not higher rank. */
  readonly ignoredUpdates: number;
  /** Events the gateway dropped for this client, from its `gap` events. */
  readonly droppedByServer: number;
  /** Per-entry delivery states evicted by the bound. */
  readonly evicted: number;
  /** Events that could not be decoded: unknown name, bad JSON or shape. */
  readonly invalid: number;
}

export interface GatewayFeedOptions {
  /** The current time, as RFC 3339. Defaults to the system clock. */
  readonly now?: () => string;
  /**
   * Called on each hello, before the feed emits anything for it: a host can
   * mount its viewer on the first one, with the gateway's buffer size.
   */
  readonly onHello?: (outcome: HelloOutcome) => void;
}

export interface GatewayFeed {
  /** The adapter a viewer connects to; its snapshot is empty. */
  readonly adapter: ViewerAdapter;
  /** Handles one server-sent event, by name and raw data. */
  receive(name: string, data: string): void;
  /**
   * The transport lost the stream at `at` (RFC 3339). The next hello then
   * lists a gap dated at the first loss since the last hello.
   */
  connectionLost(at: string): void;
  /**
   * How many entries' delivery states the feed keeps: twice the first
   * hello's `maxBufferedMessages`, as a paused viewer holds its listed
   * entries plus as many pending ones. The oldest state is evicted first.
   */
  readonly capacity: number;
  /** The ids whose delivery state is kept, oldest first. */
  trackedIds(): string[];
  counters(): GatewayFeedCounters;
}

type Counters = { -readonly [K in keyof GatewayFeedCounters]: number };

/** Creates the state of one gateway stream feeding one viewer. */
export function createGatewayFeed(options: GatewayFeedOptions = {}): GatewayFeed {
  const now = options.now ?? ((): string => new Date().toISOString());
  const listeners = new Set<(batch: readonly EntryUpdate[]) => void>();
  /** Deliveries per entry id, in insertion order: a FIFO. */
  const deliveries = new Map<string, EntryDelivery[]>();
  const counters: Counters = {
    received: 0,
    deliveryUpdates: 0,
    ignoredUpdates: 0,
    droppedByServer: 0,
    evicted: 0,
    invalid: 0,
  };
  let capacity = 2 * DEFAULT_MAX_BUFFERED_MESSAGES;
  let startedAt: string | undefined;
  let lostAt: string | undefined;
  let gapCount = 0;

  function emit(batch: readonly EntryUpdate[]): void {
    for (const listener of listeners) listener(batch);
  }

  function gap(fields: Omit<GapEntry, "kind" | "id">): void {
    gapCount += 1;
    emit([{ type: "add", entry: { kind: "gap", id: `gateway-gap-${gapCount}`, ...fields } }]);
  }

  function onHello(hello: Hello): void {
    const first = startedAt === undefined;
    const restarted = !first && startedAt !== hello.startedAt;
    const previousStartedAt = startedAt;
    if (first) capacity = 2 * hello.maxBufferedMessages;
    startedAt = hello.startedAt;
    options.onHello?.({ hello, first, reconnected: !first, restarted });
    if (!first) {
      const timestamp = lostAt ?? now();
      if (restarted && previousStartedAt !== undefined) {
        gap({
          reason: "restarted",
          timestamp,
          metadata: { custom: { previousStartedAt, startedAt: hello.startedAt } },
        });
      } else {
        gap({ reason: "disconnected", timestamp });
      }
    }
    lostAt = undefined;
  }

  function onTrace(doc: WireTraceDocument): void {
    counters.received += 1;
    if (!deliveries.has(doc.id)) {
      deliveries.set(doc.id, doc.deliveries.map(toEntryDelivery));
      for (const id of deliveries.keys()) {
        if (deliveries.size <= capacity) break;
        deliveries.delete(id);
        counters.evicted += 1;
      }
    }
    emit([{ type: "add", entry: gatewayEntry(doc) }]);
  }

  function onDelivery({ id, index, delivery }: DeliveryUpdate): void {
    const list = deliveries.get(id);
    const current = Number.isInteger(index) ? list?.[index] : undefined;
    const rank = DELIVERY_STATUS_RANK.get(delivery.status);
    const currentRank =
      current === undefined ? undefined : DELIVERY_STATUS_RANK.get(current.status);
    if (
      list === undefined ||
      current === undefined ||
      rank === undefined ||
      (currentRank !== undefined && rank <= currentRank)
    ) {
      counters.ignoredUpdates += 1;
      return;
    }
    // The index names the destination: the target and role stay the ones
    // the document announced.
    list[index] = {
      ...toEntryDelivery(delivery),
      target: current.target,
      ...(current.role !== undefined && { role: current.role }),
    };
    counters.deliveryUpdates += 1;
    emit([{ type: "update", id, metadata: { deliveries: [...list] } }]);
  }

  return {
    adapter: {
      snapshot: () => [],
      subscribe(listener): Unsubscribe {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    receive(name, data) {
      const event = decodeEvent(name, data);
      switch (event?.type) {
        case "hello":
          onHello(event.hello);
          break;
        case "trace":
          onTrace(event.doc);
          break;
        case "delivery":
          onDelivery(event.update);
          break;
        case "gap":
          counters.droppedByServer += event.dropped;
          gap({ reason: "dropped", missedCount: event.dropped, timestamp: now() });
          break;
        default:
          counters.invalid += 1;
      }
    },
    connectionLost(at) {
      if (startedAt !== undefined && lostAt === undefined) lostAt = at;
    },
    get capacity() {
      return capacity;
    },
    trackedIds: () => [...deliveries.keys()],
    counters: () => ({ ...counters }),
  };
}
