import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  type GapEntry,
  type TraceEntry,
  type UnparsedEntry,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { createGatewayFeed, type GatewayFeed, type HelloOutcome } from "../src/feed.ts";
import { gatewayEntry } from "../src/mapping.ts";
import { connection, deliveryUpdate, fixtureDoc, heartbeatDoc, hello, play } from "./fixtures.ts";

const NOW = "2026-10-29T15:00:00.000Z";

function setup(maxEntries = 1000): {
  feed: GatewayFeed;
  store: ViewerStore;
  hellos: HelloOutcome[];
} {
  const hellos: HelloOutcome[] = [];
  const feed = createGatewayFeed({ now: () => NOW, onHello: (outcome) => hellos.push(outcome) });
  const store = createViewerStore({ maxEntries });
  store.connect(feed.adapter);
  return { feed, store, hellos };
}

function receive(feed: GatewayFeed): (name: string, data: string) => void {
  return (name, data) => feed.receive(name, data);
}

function ids(store: ViewerStore): string[] {
  return store.toArray().map((entry) => entry.id);
}

function statuses(entry: ViewerEntry | undefined): string[] {
  return (entry?.metadata?.deliveries ?? []).map((d) => `${d.target}:${d.status}`);
}

function gaps(store: ViewerStore): GapEntry[] {
  return store.toArray().filter((entry): entry is GapEntry => entry.kind === "gap");
}

describe("mapping", () => {
  it("wraps a trace document's record as is, with the gateway context as metadata", () => {
    const doc = fixtureDoc(1, "trace-a2");
    const entry = gatewayEntry(doc) as TraceEntry;

    expect(entry.kind).toBe("trace");
    expect(entry.id).toBe("trace-a2");
    expect(entry.receivedAt).toBe(doc.receivedAt);
    // Shared, not copied: the fixture is deep-frozen, so it is not mutated either.
    expect(entry.record).toBe(doc.kind === "trace" ? doc.trace : undefined);
    expect(entry.metadata).toEqual({
      tenant: "tenant-a",
      chargePointId: "CP-001",
      sessionId: "session-a1",
      conversationId: "session-a1",
      source: { id: "csms:csms-a", label: "CSMS csms-a (primary)" },
      deliveries: [
        {
          target: "CP-001",
          role: "charge-point",
          status: "queued",
          updatedAt: "2026-10-29T14:32:04.000Z",
        },
      ],
      custom: { seq: 2, correlation: { callTraceId: "trace-a1", action: "BootNotification" } },
    });
  });

  it("keeps the ignored flag and leaves out a null tenant", () => {
    expect(gatewayEntry(fixtureDoc(1, "trace-a2s")).metadata?.custom).toEqual({
      seq: 3,
      correlation: { callTraceId: "trace-a1", action: "BootNotification" },
      ignored: true,
    });
    const untenanted = gatewayEntry(fixtureDoc(2, "trace-n1"));
    expect(untenanted.metadata).not.toHaveProperty("tenant");
    expect(untenanted.metadata?.source).toEqual({
      id: "charge-point:CP-003",
      label: "Charge point CP-003",
    });
  });

  it("maps a frame document to an unparsed entry, never to a record", () => {
    const entry = gatewayEntry(fixtureDoc(1, "frame-a3")) as UnparsedEntry;

    expect(entry).toEqual({
      kind: "unparsed",
      id: "frame-a3",
      receivedAt: "2026-10-29T14:32:07.000Z",
      raw: "not json",
      reason: "invalid-json",
      timestamp: "2026-10-29T14:32:07.000Z",
      direction: "cp-to-csms",
      transport: "json",
      metadata: {
        tenant: "tenant-a",
        chargePointId: "CP-001",
        sessionId: "session-a1",
        conversationId: "session-a1",
        source: { id: "charge-point:CP-001", label: "Charge point CP-001" },
        deliveries: [
          {
            target: "csms-a",
            role: "primary",
            status: "dropped",
            reason: "not-forwarded",
            updatedAt: "2026-10-29T14:32:07.000Z",
          },
        ],
        custom: { seq: 4 },
      },
    });
    expect(entry).not.toHaveProperty("record");
  });
});

describe("delivery updates", () => {
  it("modify the existing row instead of adding one", () => {
    const { feed, store } = setup();
    play(receive(feed), connection(1));

    expect(ids(store).filter((id) => id === "trace-a1")).toHaveLength(1);
    expect(store.get("trace-a1")?.kind).toBe("trace");
    expect(statuses(store.get("trace-a1"))).toEqual(["csms-a:written", "csms-b:written"]);
    expect(statuses(store.get("trace-b2"))).toEqual(["CP-002:failed"]);
    expect(store.get("trace-b2")?.metadata?.deliveries?.[0]?.reason).toBe("socket closed");
    expect(statuses(store.get("trace-a2"))).toEqual(["CP-001:written"]);
  });

  it("ignores lower-rank, unknown-id and out-of-range updates", () => {
    const { feed, store } = setup();
    play(receive(feed), connection(1));

    // queued after written, trace-unknown, index 5 of trace-b1.
    expect(feed.counters().ignoredUpdates).toBe(3);
    expect(statuses(store.get("trace-a1"))).toEqual(["csms-a:written", "csms-b:written"]);
    expect(statuses(store.get("trace-b1"))).toEqual(["csms-c:written"]);
    expect(store.getStats().unknownUpdates).toBe(0);
  });

  it("ignores an update of the same rank and an unknown status", () => {
    const { feed, store } = setup();
    feed.receive("hello", hello(10));
    feed.receive("trace", JSON.stringify(heartbeatDoc("t1")));
    feed.receive("delivery", deliveryUpdate("t1", "written"));
    feed.receive("delivery", deliveryUpdate("t1", "failed"));
    feed.receive("delivery", deliveryUpdate("t1", "teleported"));

    expect(statuses(store.get("t1"))).toEqual(["csms-a:written"]);
    expect(feed.counters().ignoredUpdates).toBe(2);
  });

  it("resolves the target from the index, not from the update", () => {
    const { feed, store } = setup();
    feed.receive("hello", hello(10));
    feed.receive("trace", JSON.stringify(heartbeatDoc("t1")));
    feed.receive(
      "delivery",
      JSON.stringify({
        id: "t1",
        index: 0,
        delivery: { target: "elsewhere", role: "primary", status: "written", updatedAt: NOW },
      }),
    );

    expect(statuses(store.get("t1"))).toEqual(["csms-a:written"]);
  });
});

describe("bounded state", () => {
  it("evicts the oldest per-id delivery state past twice the gateway's buffer", () => {
    const { feed, store } = setup(3);
    feed.receive("hello", hello(3));
    expect(feed.capacity).toBe(6);
    for (let i = 0; i < 10; i += 1) {
      feed.receive("trace", JSON.stringify(heartbeatDoc(`t${i}`)));
    }

    expect(feed.counters().deliveryStatesEvicted).toBe(4);
    expect(feed.trackedIds()).toEqual(["t4", "t5", "t6", "t7", "t8", "t9"]);
    feed.receive("delivery", deliveryUpdate("t3", "written"));
    feed.receive("delivery", deliveryUpdate("t9", "written"));
    expect(feed.counters().ignoredUpdates).toBe(1);
    expect(statuses(store.get("t9"))).toEqual(["csms-a:written"]);
  });

  it("stays bounded under a burst of documents and updates", () => {
    const { feed } = setup(5);
    feed.receive("hello", hello(5));
    for (let i = 0; i < 1000; i += 1) {
      feed.receive("trace", JSON.stringify(heartbeatDoc(`t${i}`)));
      feed.receive("delivery", deliveryUpdate(`t${i}`, "submitted"));
      feed.receive("delivery", deliveryUpdate(`t${i - 20}`, "written"));
    }

    expect(feed.trackedIds()).toHaveLength(10);
    expect(feed.counters().deliveryStatesEvicted).toBe(990);
  });

  it("keeps the state of listed entries while the paused store holds more than its limit", () => {
    const { feed, store } = setup(3);
    feed.receive("hello", hello(3));
    for (const id of ["l0", "l1", "l2"]) feed.receive("trace", JSON.stringify(heartbeatDoc(id)));
    store.pause();
    for (const id of ["p0", "p1", "p2"]) feed.receive("trace", JSON.stringify(heartbeatDoc(id)));
    feed.receive("delivery", deliveryUpdate("l0", "written"));

    expect(statuses(store.get("l0"))).toEqual(["csms-a:written"]);
    expect(feed.counters().ignoredUpdates).toBe(0);
  });

  it("rejects a hello whose buffer size is outside the gateway's range", () => {
    const { feed, hellos } = setup();
    feed.receive("hello", hello(100_001));
    feed.receive("hello", hello(0));

    expect(hellos).toEqual([]);
    expect(feed.counters().invalid).toBe(2);
    feed.receive("hello", hello(100_000));
    expect(feed.capacity).toBe(200_000);
  });

  it("keeps the first capacity when a restart announces another buffer size", () => {
    const { feed } = setup();
    feed.receive("hello", hello(3));
    feed.connectionLost("2026-10-29T14:40:00.000Z");
    feed.receive("hello", hello(50, "2026-10-29T14:41:00.000Z"));

    expect(feed.capacity).toBe(6);
  });
});

describe("gaps", () => {
  it("lists a gap the server reports as dropped events", () => {
    const { feed, store } = setup();
    play(receive(feed), connection(1));

    expect(gaps(store)).toEqual([
      { kind: "gap", id: "gateway-gap-1", reason: "dropped", missedCount: 3, timestamp: NOW },
    ]);
    expect(feed.counters().droppedByServer).toBe(3);
  });

  it("lists a disconnected gap at the time of the loss once the stream is back", () => {
    const { feed, store, hellos } = setup();
    play(receive(feed), connection(1));
    feed.connectionLost("2026-10-29T14:32:10.000Z");
    expect(gaps(store)).toHaveLength(1);
    play(receive(feed), connection(2));

    const gap = gaps(store)[1];
    expect(gap).toEqual({
      kind: "gap",
      id: "gateway-gap-2",
      reason: "disconnected",
      timestamp: "2026-10-29T14:32:10.000Z",
    });
    // Listed before the first entry of the new connection.
    expect(ids(store).indexOf("gateway-gap-2")).toBe(ids(store).indexOf("trace-a4") - 1);
    expect(
      hellos.map(({ first, reconnected, restarted }) => [first, reconnected, restarted]),
    ).toEqual([
      [true, false, false],
      [false, true, false],
    ]);
  });

  it("marks the gap restarted when the gateway's startedAt changed", () => {
    const { feed, store, hellos } = setup();
    play(receive(feed), connection(1));
    feed.connectionLost("2026-10-29T14:32:10.000Z");
    play(receive(feed), connection(2));
    feed.connectionLost("2026-10-29T14:32:25.000Z");
    play(receive(feed), connection(3));

    expect(gaps(store)[2]).toEqual({
      kind: "gap",
      id: "gateway-gap-3",
      reason: "restarted",
      timestamp: "2026-10-29T14:32:25.000Z",
      metadata: {
        custom: {
          previousStartedAt: "2026-10-29T14:00:00.000Z",
          startedAt: "2026-10-29T14:32:30.000Z",
        },
      },
    });
    expect(hellos.at(-1)?.restarted).toBe(true);
    expect(statuses(store.get("trace-b5"))).toEqual(["csms-c:submitted"]);
  });

  it("dates a reconnection without a reported loss at the time of the hello", () => {
    const { feed, store } = setup();
    feed.receive("hello", hello(10));
    feed.receive("hello", hello(10));

    expect(gaps(store)).toEqual([
      { kind: "gap", id: "gateway-gap-1", reason: "disconnected", timestamp: NOW },
    ]);
  });

  it("lists no gap for a loss before the first hello", () => {
    const { feed, store } = setup();
    feed.connectionLost("2026-10-29T14:30:00.000Z");
    feed.receive("hello", hello(10));

    expect(store.size).toBe(0);
  });
});

describe("pause and resume", () => {
  it("applies a burst of updates received while the store is paused", () => {
    const { feed, store } = setup(100);
    feed.receive("hello", hello(100));
    feed.receive("trace", JSON.stringify(heartbeatDoc("listed")));
    store.pause();
    for (let i = 0; i < 20; i += 1) {
      feed.receive("trace", JSON.stringify(heartbeatDoc(`p${i}`)));
    }
    for (let i = 0; i < 20; i += 1) {
      feed.receive("delivery", deliveryUpdate(`p${i}`, "submitted"));
      feed.receive("delivery", deliveryUpdate(`p${i}`, i % 2 === 0 ? "written" : "failed"));
      feed.receive("delivery", deliveryUpdate(`p${i}`, "queued"));
    }
    feed.receive("delivery", deliveryUpdate("listed", "written"));

    expect(store.size).toBe(1);
    expect(statuses(store.get("listed"))).toEqual(["csms-a:written"]);
    store.resume();

    expect(store.size).toBe(21);
    expect(statuses(store.get("p0"))).toEqual(["csms-a:written"]);
    expect(statuses(store.get("p1"))).toEqual(["csms-a:failed"]);
    expect(feed.counters().ignoredUpdates).toBe(20);
    expect(store.getStats().unknownUpdates).toBe(0);
  });
});

describe("counters", () => {
  it("counts received documents and undecodable events", () => {
    const { feed } = setup();
    play(receive(feed), connection(1));
    feed.receive("trace", "{not json");
    feed.receive("mystery", "{}");
    feed.receive("trace", JSON.stringify({ id: "x", kind: "trace" }));

    expect(feed.counters()).toEqual({
      received: 6,
      deliveryUpdates: 6,
      ignoredUpdates: 3,
      droppedByServer: 3,
      deliveryStatesEvicted: 0,
      invalid: 3,
    });
  });
});
