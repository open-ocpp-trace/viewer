import { describe, expect, it } from "vite-plus/test";

import {
  computeStats,
  createCorrelator,
  createFilterEngine,
  createViewerStore,
  type Correlator,
  type FilterChange,
  type FilterEngine,
  type FilterEngineOptions,
  type FilterFieldDefinition,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { cachedSize } from "../src/filter-engine.ts";
import { call, result } from "./correlation-fixtures.ts";
import { context, gateway, record, select, simulator } from "./filter-fixtures.ts";
import { add, gap } from "./store-fixtures.ts";

function listed(engine: FilterEngine): string[] {
  const out: string[] = [];
  for (let index = 0; index < engine.size; index += 1) out.push(engine.at(index)!.id);
  return out;
}

function setup(
  entries: readonly ViewerEntry[] = [],
  options: FilterEngineOptions = {},
  store: ViewerStore = createViewerStore(),
): { store: ViewerStore; engine: FilterEngine; changes: FilterChange[]; reported: unknown[] } {
  store.load(entries);
  const reported: unknown[] = [];
  const engine = createFilterEngine({ ...options, onError: (error) => reported.push(error) });
  const changes: FilterChange[] = [];
  engine.subscribe((change) => changes.push(change));
  engine.connect(store);
  return { store, engine, changes, reported };
}

/** Asserts the engine equals a full recomputation over the store (no producer field, no correlator). */
function expectRecomputed(engine: FilterEngine, store: ViewerStore): void {
  const entries = store.toArray();
  const ids = select(engine.filter, entries);
  expect(listed(engine)).toEqual(ids);
  const matching = new Set(ids);
  expect(engine.getStats()).toEqual({
    buffer: computeStats(entries),
    filtered: computeStats(entries.filter((entry) => matching.has(entry.id))),
  });
  expect(cachedSize(engine)).toBe(store.size);
}

const heartbeat = { actions: ["Heartbeat"] };

describe("FilterEngine", () => {
  it("lists every entry with the empty filter, in store order", () => {
    const { engine, changes } = setup([simulator.boot, simulator.gap, gateway.primary]);

    expect(listed(engine)).toEqual(["s1", "s5", "g1"]);
    expect(engine.filter).toEqual({});
    expect(engine.indexOf("g1")).toBe(2);
    expect(engine.indexOf("nope")).toBe(-1);
    expect([engine.at(-1), engine.at(0.5), engine.at(3)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(changes).toEqual([{ version: 1 }]);
    expect(engine.version).toBe(1);
  });

  it("recomputes on setFilter and notifies only when membership changes", () => {
    const { engine, changes } = setup([simulator.boot, simulator.status, simulator.gap]);

    engine.setFilter({ chargePointIds: ["CP-1"] });
    expect(changes).toHaveLength(1);
    engine.setFilter({ actions: ["StatusNotification"] });
    expect(listed(engine)).toEqual(["s2", "s5"]);
    expect(engine.filter).toEqual({ actions: ["StatusNotification"] });
    expect(changes).toEqual([{ version: 1 }, { version: 2 }]);

    engine.reset();
    expect(engine.filter).toEqual({});
    expect(listed(engine)).toEqual(["s1", "s2", "s5"]);
    expect(engine.version).toBe(3);
  });

  it("leaves its state unchanged when setFilter rejects a filter", () => {
    const { engine } = setup([simulator.boot]);
    engine.setFilter({ tenants: [null] });

    expect(() => engine.setFilter({ tenants: [1 as unknown as string] })).toThrow(RangeError);
    expect(() => engine.setFilter({ searchPayloads: true })).toThrow(RangeError);
    expect(() => engine.setFilter({ fields: [{ id: "__proto__", values: [] }] })).toThrow(
      RangeError,
    );
    expect(engine.filter).toEqual({ tenants: [null] });
    expect(listed(engine)).toEqual(["s1"]);
  });

  it("rejects duplicate producer field ids at creation", () => {
    const field = (id: string): FilterFieldDefinition => ({ id, label: id, values: () => [] });

    expect(() => createFilterEngine({ fields: [field("__proto__"), field("__proto__")] })).toThrow(
      RangeError,
    );
    expect(() => createFilterEngine({ fields: [field("a"), field("constructor")] })).not.toThrow();
  });

  it("filters on a producer field and on payloads when enabled", () => {
    const zone: FilterFieldDefinition = {
      id: "zone",
      label: "Zone",
      values: (entry) => (entry.id === "s1" ? ["north"] : []),
    };
    const { engine } = setup([simulator.boot, simulator.status], {
      fields: [zone],
      payloadSearch: true,
    });

    engine.setFilter({ fields: [{ id: "zone", values: ["north"] }] });
    expect(listed(engine)).toEqual(["s1"]);
    engine.setFilter({ text: "x", searchPayloads: true });
    expect(listed(engine)).toEqual([]);
  });

  it("matches an entry against the current filter before any connect", () => {
    const engine = createFilterEngine();
    engine.setFilter({ kinds: ["gap"] });

    expect(engine.size).toBe(0);
    expect(engine.matches(simulator.gap)).toBe(true);
    expect(engine.matches(simulator.boot)).toBe(false);
  });

  it("follows adds, delivery updates, evictions and clear", () => {
    const store = createViewerStore({ maxEntries: 3 });
    const { engine, changes } = setup([], { fields: [] }, store);
    engine.setFilter({ deliveryStatuses: ["failed"] });

    store.apply([add(gateway.queued), add(simulator.boot)]);
    expect(listed(engine)).toEqual([]);
    expect(changes).toEqual([{ version: 1 }]);

    store.apply([
      {
        type: "update",
        id: "g2",
        metadata: { deliveries: [{ target: "csms-a", status: "failed" }] },
      },
    ]);
    expect(listed(engine)).toEqual(["g2"]);
    expect(engine.at(0)!.metadata?.deliveries?.[0]?.status).toBe("failed");
    store.apply([{ type: "update", id: "s1", metadata: { tenant: "t" } }]);
    expect(engine.getStats().buffer.tenants.get("t")).toBe(1);
    expect(changes).toHaveLength(3);
    store.apply([{ type: "update", id: "s1", metadata: { conversationId: "c" } }]);
    expect(changes).toHaveLength(3);

    store.apply([add(simulator.status), add(simulator.gap)]);
    expect(listed(engine)).toEqual(["s5"]);
    expect(engine.indexOf("g2")).toBe(-1);

    store.clear();
    expect(engine.size).toBe(0);
    expect(changes.map((change) => change.version)).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts the listed buffer and the matching entries, not the pending ones", () => {
    const { store, engine } = setup([simulator.boot, simulator.gap, gateway.primary]);
    const before = engine.getStats();
    expect(before.buffer).toEqual(computeStats(store.toArray()));
    expect(before.filtered).toEqual(before.buffer);

    engine.setFilter({ chargePointIds: ["CP-1"] });
    store.pause();
    store.apply([add(simulator.status)]);
    const stats = engine.getStats();

    expect(stats).not.toBe(before);
    expect(stats).toBe(engine.getStats());
    expect(stats.buffer.total).toBe(3);
    expect(stats.buffer.chargePointIds).toEqual(
      new Map<string | null, number>([
        ["CP-1", 1],
        [null, 1],
        ["CP-7", 1],
      ]),
    );
    expect(stats.filtered.kinds).toEqual({ trace: 1, unparsed: 0, gap: 1 });
  });

  it("notifies when a listed entry is replaced, even if no count changes", () => {
    const { store, engine, changes } = setup([gateway.primary]);
    const stats = engine.getStats();

    store.apply([
      {
        type: "update",
        id: "g1",
        metadata: {
          deliveries: [
            { target: "csms-a", status: "failed" },
            { target: "csms-b", status: "written" },
          ],
        },
      },
    ]);

    expect(changes).toEqual([{ version: 1 }, { version: 2 }]);
    expect(engine.at(0)).toBe(store.get("g1"));
    expect(engine.getStats()).not.toBe(stats);
    expect(engine.getStats()).toEqual(stats);
  });

  it("does not notify when an update of a hidden entry only reorders multi-valued values", () => {
    const { store, engine, changes } = setup([gateway.primary]);
    engine.setFilter({ kinds: ["gap"] });
    const stats = engine.getStats();
    const version = engine.version;

    store.apply([
      {
        type: "update",
        id: "g1",
        metadata: {
          deliveries: [
            { target: "csms-a", status: "failed" },
            { target: "csms-b", status: "written" },
          ],
        },
      },
    ]);

    expect(engine.version).toBe(version);
    expect(changes).toHaveLength(version);
    expect(engine.getStats()).toBe(stats);
  });

  it("does not list pending entries until resume", () => {
    const { store, engine } = setup([simulator.boot]);

    store.pause();
    store.apply([add(simulator.status)]);
    expect(listed(engine)).toEqual(["s1"]);
    store.resume();
    expect(listed(engine)).toEqual(["s1", "s2"]);
  });

  it.each(["before", "after"])(
    "lists a response by its derived action when the correlator connects %s the engine",
    (order) => {
      const store = createViewerStore();
      store.load([call("c1", "m1"), gap("x")]);
      const correlator = createCorrelator();
      const engine = createFilterEngine({ correlator });
      engine.setFilter(heartbeat);
      if (order === "before") correlator.connect(store);
      engine.connect(store);
      if (order === "after") correlator.connect(store);

      store.apply([add(result("r1", "m1"))]);

      expect(listed(engine)).toEqual(["c1", "x", "r1"]);
      expect(listed(engine)).toEqual(select(heartbeat, store.toArray(), context([], correlator)));
    },
  );

  it("drops derived actions when the correlator is disconnected", () => {
    const store = createViewerStore();
    const correlator = createCorrelator();
    const unsubscribe = correlator.connect(store);
    const { engine } = setup([], { correlator }, store);
    engine.setFilter(heartbeat);
    store.apply([add(call("c1", "m1")), add(result("r1", "m1"))]);
    expect(listed(engine)).toEqual(["c1", "r1"]);

    unsubscribe();

    expect(listed(engine)).toEqual(["c1"]);
  });
});

describe("FilterEngine connection", () => {
  it("throws on a second connect and can reconnect once unsubscribed", () => {
    const store = createViewerStore();
    store.load([simulator.boot]);
    const engine = createFilterEngine();
    const changes: FilterChange[] = [];
    engine.subscribe((change) => changes.push(change));
    const unsubscribe = engine.connect(store);

    expect(() => engine.connect(store)).toThrow("already connected");
    unsubscribe();
    unsubscribe();
    expect(engine.size).toBe(0);
    store.apply([add(simulator.status)]);
    expect(changes).toEqual([{ version: 1 }, { version: 2 }]);

    engine.connect(store);
    expect(listed(engine)).toEqual(["s1", "s2"]);
  });

  it("follows a store change a listener makes during the seed notification", () => {
    const store = createViewerStore();
    store.load([simulator.boot]);
    const engine = createFilterEngine();
    let reacted = false;
    engine.subscribe(() => {
      if (reacted) return;
      reacted = true;
      store.apply([add(simulator.status)]);
    });

    engine.connect(store);

    expect(listed(engine)).toEqual(["s1", "s2"]);
    expectRecomputed(engine, store);
  });

  it("stays disconnected and unsubscribes when seeding throws", () => {
    const store = createViewerStore();
    store.load([simulator.boot]);
    const engine = createFilterEngine();
    let unsubscribed = false;
    const failing: ViewerStore = {
      ...store,
      subscribe: (listener) => {
        const unsubscribe = store.subscribe(listener);
        return () => {
          unsubscribed = true;
          unsubscribe();
        };
      },
      toArray: () => {
        throw new Error("toArray");
      },
    };

    expect(() => engine.connect(failing)).toThrow("toArray");
    expect(engine.size).toBe(0);
    expect(unsubscribed).toBe(true);
    engine.connect(store);
    expect(listed(engine)).toEqual(["s1"]);
  });

  it.each(["store", "correlator"])(
    "stays disconnected without notifying when subscribing to the %s throws",
    (source) => {
      const store = createViewerStore();
      store.load([simulator.boot]);
      const correlator = createCorrelator();
      let storeUnsubscribed = false;
      const failingStore: ViewerStore = {
        ...store,
        subscribe: (listener) => {
          if (source === "store") throw new Error("subscribe");
          const unsubscribe = store.subscribe(listener);
          return () => {
            storeUnsubscribed = true;
            unsubscribe();
          };
        },
      };
      let failCorrelator = source === "correlator";
      const failingCorrelator: Correlator = {
        ...correlator,
        subscribe: (listener) => {
          if (failCorrelator) throw new Error("subscribe");
          return correlator.subscribe(listener);
        },
      };
      const engine = createFilterEngine({ correlator: failingCorrelator });
      const changes: FilterChange[] = [];
      engine.subscribe((change) => changes.push(change));

      expect(() => engine.connect(failingStore)).toThrow("subscribe");

      expect(changes).toEqual([]);
      expect(engine.size).toBe(0);
      expect(storeUnsubscribed).toBe(source === "correlator");
      store.apply([add(simulator.status)]);
      expect(engine.size).toBe(0);
      failCorrelator = false;
      engine.connect(store);
      expect(listed(engine)).toEqual(["s1", "s2"]);
    },
  );

  it("reports listener errors without throwing into the store or connect", () => {
    const store = createViewerStore();
    store.load([simulator.boot]);
    const reported: unknown[] = [];
    const engine = createFilterEngine({ onError: (error) => reported.push(error) });
    const seen: number[] = [];
    engine.subscribe(() => {
      throw new Error("listener");
    });
    engine.subscribe((change) => seen.push(change.version));

    const unsubscribe = engine.connect(store);
    store.apply([add(simulator.status)]);
    engine.setFilter({ kinds: [] });

    expect(seen).toEqual([1, 2, 3]);
    expect(reported).toEqual([new Error("listener"), new Error("listener"), new Error("listener")]);
    unsubscribe();
  });

  it("keeps its state and reports when reading the store fails while following it", () => {
    const store = createViewerStore();
    let fail = false;
    const flaky: ViewerStore = {
      ...store,
      get: (id) => {
        if (fail) throw new Error("get");
        return store.get(id);
      },
    };
    const { engine, reported } = setup([simulator.boot], {}, flaky);
    fail = true;

    store.apply([add(simulator.status)]);

    expect(listed(engine)).toEqual(["s1"]);
    expect(engine.getStats().buffer.total).toBe(1);
    expect(reported).toEqual([new Error("get")]);

    fail = false;
    store.apply([add(simulator.result)]);

    expect(listed(engine)).toEqual(["s1", "s2", "s3"]);
    expect(engine.getStats().buffer.total).toBe(3);
  });

  it("returns the current entry object after a metadata update", () => {
    const { store, engine } = setup([record("t1")]);

    store.apply([{ type: "update", id: "t1", metadata: { tenant: "acme" } }]);

    expect(engine.at(0)).toBe(store.get("t1"));
  });
});

describe("FilterEngine reentrancy", () => {
  it("follows a store change a listener makes during a store-driven notification", () => {
    const { store, engine } = setup([simulator.boot]);
    let reacted = false;
    engine.subscribe(() => {
      if (reacted) return;
      reacted = true;
      store.apply([add(gateway.primary)]);
    });

    store.apply([add(simulator.status)]);

    expect(listed(engine)).toEqual(["s1", "s2", "g1"]);
    expectRecomputed(engine, store);
  });

  it("applies a filter a listener sets during a store-driven notification", () => {
    const { store, engine } = setup([simulator.boot, gateway.primary]);
    let reacted = false;
    engine.subscribe(() => {
      if (reacted) return;
      reacted = true;
      engine.setFilter({ chargePointIds: ["CP-1"] });
    });

    store.apply([add(simulator.status), add(simulator.gap)]);

    expect(engine.filter).toEqual({ chargePointIds: ["CP-1"] });
    expectRecomputed(engine, store);
    store.apply([add(simulator.result)]);
    expectRecomputed(engine, store);
  });

  it("releases its state when a listener unsubscribes during a store-driven notification", () => {
    const store = createViewerStore();
    store.load([simulator.boot]);
    const engine = createFilterEngine();
    let unsubscribe: (() => void) | undefined;
    engine.subscribe((change) => {
      if (change.version === 2) unsubscribe?.();
    });
    unsubscribe = engine.connect(store);

    store.apply([add(simulator.status)]);

    expect(engine.size).toBe(0);
    expect(cachedSize(engine)).toBe(0);
    expect(engine.version).toBe(3);
    store.apply([add(simulator.result)]);
    expect(engine.size).toBe(0);
    expect(engine.version).toBe(3);
    engine.connect(store);
    expect(listed(engine)).toEqual(["s1", "s2", "s3"]);
    expectRecomputed(engine, store);
  });
});
