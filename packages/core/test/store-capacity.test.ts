import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { coreWeight, metadataWeight } from "../src/store-estimate.ts";
import { storeInternals } from "../src/store.ts";
import { add, adds, gap, ids, trace, traceRecord, unparsed } from "./store-fixtures.ts";

const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/** The weights of the listed entries, none of them oversized. */
function retainedBytes(store: ViewerStore): number {
  return store
    .toArray()
    .reduce((sum, entry) => sum + coreWeight(entry, NO_LIMIT) + metadataWeight(entry, NO_LIMIT), 0);
}

function expectConsistent(store: ViewerStore): void {
  expect(storeInternals(store).indexSize()).toBe(store.size);
  expect(store.getStats().listed).toBe(store.size);
  store.toArray().forEach((entry, index) => {
    expect(store.indexOf(entry.id)).toBe(index);
    expect(store.at(index)).toBe(entry);
  });
}

describe("ViewerStore capacity by count", () => {
  it("evicts the oldest entries first and accounts for them", () => {
    const store = createViewerStore({ maxEntries: 3 });
    store.apply(adds("a", "b", "c", "d"));
    store.apply(adds("e"));

    expect(ids(store)).toEqual(["c", "d", "e"]);
    expect(store.getStats().evicted).toBe(2);
    expect(store.get("a")).toBeUndefined();
    expect(store.indexOf("b")).toBe(-1);
    expectConsistent(store);
  });

  it("keeps a single entry with maxEntries 1", () => {
    const store = createViewerStore({ maxEntries: 1 });
    store.apply(adds("a", "b"));
    store.load([trace("c")]);

    expect(ids(store)).toEqual(["c"]);
    expect(store.getStats().evicted).toBe(2);
    expectConsistent(store);
  });

  it("accepts an add for an evicted id as a new entry at the end (rule 6)", () => {
    const store = createViewerStore({ maxEntries: 2 });
    store.apply(adds("a", "b", "c", "a"));

    expect(ids(store)).toEqual(["c", "a"]);
    expect(store.getStats().duplicates).toBe(0);
    expectConsistent(store);
  });
});

describe("ViewerStore capacity by bytes", () => {
  const entry = (id: string): ReturnType<typeof unparsed> => unparsed(id, "x".repeat(1000));
  const weight = coreWeight(entry("a"), NO_LIMIT);

  it("evicts the oldest entries while the retained bytes exceed maxBytes", () => {
    const maxBytes = weight * 2 + 10;
    const store = createViewerStore({ maxBytes });
    store.apply(["a", "b", "c", "d"].map((id) => add(entry(id))));

    expect(ids(store)).toEqual(["c", "d"]);
    expect(store.getStats().evicted).toBe(2);
    expect(store.getStats().listedBytes).toBe(retainedBytes(store));
    expectConsistent(store);
  });

  it("counts metadata in the retained bytes", () => {
    const store = createViewerStore();
    const rich = trace("a", { metadata: { custom: { note: "y".repeat(500) } } });
    store.apply([add(rich), add(trace("b"))]);

    expect(store.getStats().listedBytes).toBe(retainedBytes(store));
    expect(store.getStats().listedBytes).toBeGreaterThan(1000);
  });

  it("keeps an oversized entry alone until the next add evicts it", () => {
    const store = createViewerStore({ maxBytes: weight * 3 });
    const huge = unparsed("huge", "z".repeat(100_000));
    store.apply(["a", "b"].map((id) => add(entry(id))));
    store.apply([add(huge)]);

    expect(ids(store)).toEqual(["huge"]);
    expect(store.getStats().evicted).toBe(2);
    expect(store.getStats().listedBytes).toBeGreaterThan(weight * 3);

    store.apply([add(entry("c"))]);

    expect(ids(store)).toEqual(["c"]);
    expect(store.getStats().evicted).toBe(3);
    expect(store.getStats().listedBytes).toBe(weight);
    expectConsistent(store);
  });

  it("weighs a record once, when it is added", () => {
    let reads = 0;
    const record = traceRecord("a");
    Object.defineProperty(record, "payload", {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    const store = createViewerStore({ maxEntries: 2 });
    store.apply([add({ kind: "trace", id: "a", record })]);
    store.apply(adds("b"));
    store.getStats();

    expect(reads).toBe(1);
  });

  it("accepts hostile records without throwing", () => {
    const record = traceRecord("a") as unknown as Record<string, unknown>;
    record["meta"] = { self: record, big: 1n, symbol: Symbol("s") };
    Object.defineProperty(record, "payload", {
      enumerable: true,
      get() {
        throw new Error("hostile");
      },
    });
    const store = createViewerStore();

    expect(() =>
      store.apply([add({ kind: "trace", id: "a", record } as unknown as ReturnType<typeof trace>)]),
    ).not.toThrow();
    expect(store.size).toBe(1);
  });
});

describe("ViewerStore byte accounting of untrusted data", () => {
  const large = "x".repeat(200_000);

  it.each([
    ["trace", { ...trace("b"), extra: large }],
    ["unparsed", { ...unparsed("b"), extra: large }],
    ["gap", { ...gap("b"), extra: large }],
  ])("does not retain an unweighed extra field on a %s entry", (_kind, extra) => {
    const store = createViewerStore({ maxBytes: 100_000 });
    store.apply([add(trace("a")), add(extra as unknown as ViewerEntry)]);

    expect(store.get("b")).not.toHaveProperty("extra");
    expect(store.get("b")?.kind).toBe(extra.kind);
    expect(ids(store)).toEqual(["a", "b"]);
    expect(store.getStats().listedBytes).toBe(retainedBytes(store));
  });

  it("weighs a large optional field of an entry", () => {
    const store = createViewerStore({ maxBytes: 100_000 });
    store.apply([add(trace("a")), add({ ...gap("b"), reason: large })]);

    expect(ids(store)).toEqual(["b"]);
    expect(store.getStats().evicted).toBe(1);
  });

  /** Patches adding `count` custom keys numbered from `from`. */
  const customKeys = (from: number, count: number): Record<string, number> => {
    const custom: Record<string, number> = {};
    for (let key = from; key < from + count; key++) custom[`k${key}`] = 0;
    return custom;
  };

  it("evicts once repeated metadata updates grow a listed entry past maxBytes", () => {
    const maxBytes = 4 * 1024 * 1024;
    const store = createViewerStore({ maxBytes });
    store.apply(adds("a", "b"));
    for (let round = 0; round < 10; round++) {
      store.apply([
        { type: "update", id: "b", metadata: { custom: customKeys(round * 20_000, 20_000) } },
      ]);
    }

    expect(ids(store)).toEqual(["b"]);
    expect(store.getStats().evicted).toBe(1);
    expect(store.getStats().listedBytes).toBeGreaterThan(maxBytes);
  });

  it("drops pending entries once repeated delivery updates grow one past the budget", () => {
    const store = createViewerStore({ maxBytes: 4 * 1024 * 1024 });
    store.pause();
    store.apply(adds("a", "b"));
    for (let round = 0; round < 10; round++) {
      const deliveries = Array.from({ length: 10_000 }, (_, index) => ({
        target: `t${round * 10_000 + index}`,
        status: "queued",
      }));
      store.apply([{ type: "update", id: "b", metadata: { deliveries } }]);
    }

    expect(store.getStats()).toMatchObject({ pending: 1, droppedPending: 1 });
    expect(store.isPending("b")).toBe(true);
  });
});

describe("ViewerStore under sustained traffic", () => {
  it("keeps its bounds, index and backing array bounded", () => {
    const maxEntries = 500;
    const store = createViewerStore({ maxEntries, maxBytes: 200_000 });
    let next = 0;
    for (let batch = 0; batch < 1000; batch++) {
      const items = [];
      for (let i = 0; i < 100; i++) {
        const id = `e${next++}`;
        items.push(i % 10 === 0 ? add(unparsed(id, "x".repeat(2000))) : add(trace(id)));
      }
      store.apply(items);

      expect(store.size).toBeLessThanOrEqual(maxEntries);
      expect(store.getStats().listedBytes).toBeLessThanOrEqual(200_000);
      expect(storeInternals(store).indexSize()).toBe(store.size);
      expect(storeInternals(store).backingLength()).toBeLessThanOrEqual(2 * maxEntries + 1024);
    }

    expect(store.getStats().evicted).toBe(next - store.size);
    expect(store.at(store.size - 1)?.id).toBe(`e${next - 1}`);
    expectConsistent(store);
  });
});
