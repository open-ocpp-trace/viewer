import { describe, expect, it } from "vite-plus/test";

import { createViewerStore, type EntryUpdate } from "@open-ocpp-trace/viewer-core";

import { storeInternals } from "../src/store.ts";
import { adds, ids, mirror, traceRecord } from "./store-fixtures.ts";

function untrusted(item: unknown): EntryUpdate {
  return item as EntryUpdate;
}

describe("ViewerStore reads each untrusted field once", () => {
  it("keeps the revision it checked, not a later read of the getter", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    let reads = 0;
    const flipping = {
      type: "update",
      id: "a",
      get revision() {
        return reads++ === 0 ? 1 : "zz";
      },
      metadata: { tenant: "t" },
    };
    store.apply([untrusted(flipping)]);

    expect(reads).toBe(1);
    store.apply([untrusted({ type: "update", id: "a", revision: 1, metadata: { tenant: "u" } })]);
    expect(store.getStats().staleUpdates).toBe(1);
    expect(store.get("a")?.metadata).toEqual({ tenant: "t" });
  });

  it("merges the metadata it checked, not a later read of the getter", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    let reads = 0;
    const flipping = {
      type: "update",
      id: "a",
      get metadata() {
        return reads++ === 0 ? { tenant: "t" } : null;
      },
    };

    expect(() => store.apply([untrusted(flipping)])).not.toThrow();
    expect(store.get("a")?.metadata).toEqual({ tenant: "t" });
  });

  it("indexes the id it checked, so an unstable id getter cannot leak the index", () => {
    const store = createViewerStore({ maxEntries: 2 });
    let reads = 0;
    for (let count = 0; count < 100; count++) {
      const entry = {
        kind: "gap",
        reason: "x",
        get id() {
          return `k${reads++}`;
        },
      };
      store.apply([untrusted({ type: "add", entry })]);
    }

    expect(store.size).toBe(2);
    expect(storeInternals(store).indexSize()).toBe(2);
    for (const id of ids(store)) expect(store.get(id)?.id).toBe(id);
  });

  it("copies and weighs the fields of the kind it checked", () => {
    const store = createViewerStore();
    let reads = 0;
    const record = { ...traceRecord("k"), raw: "x".repeat(1_000_000) };
    const entry = {
      id: "k",
      get kind() {
        return reads++ === 0 ? "trace" : "gap";
      },
      record,
    };
    store.apply([untrusted({ type: "add", entry })]);

    const stored = store.get("k");
    expect(stored?.kind).toBe("trace");
    expect(stored?.kind === "trace" && stored.record).toBe(record);
    expect(store.getStats().listedBytes).toBeGreaterThan(2_000_000);
  });
});

describe("ViewerStore item atomicity", () => {
  it("drops and counts an update that throws, leaving its entry and watermark as they were", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    const hostileCustom = {
      get boom(): never {
        throw new Error("getter");
      },
    };
    const state = mirror(store);
    const batch = [
      { type: "update", id: "a", revision: 5, metadata: { tenant: "r5" } },
      { type: "update", id: "a", revision: 6, metadata: { custom: hostileCustom } },
      ...adds("c"),
    ];

    expect(() => store.apply(batch.map(untrusted))).not.toThrow();
    expect(store.getStats().invalid).toBe(1);
    expect(store.get("a")?.metadata).toEqual({ tenant: "r5" });
    expect(state.ids).toEqual(["a", "c"]);
    store.apply([untrusted({ type: "update", id: "a", revision: 6, metadata: { tenant: "r6" } })]);
    expect(store.getStats().staleUpdates).toBe(0);
    expect(store.get("a")?.metadata).toEqual({ tenant: "r6" });
  });

  it("drops and counts an add whose metadata throws, still applying the rest", () => {
    const store = createViewerStore({ maxEntries: 2 });
    store.apply(adds("a", "b"));
    const state = mirror(store);
    const metadata = {
      get deliveries(): never {
        throw new Error("getter");
      },
    };
    const hostile = { type: "add", entry: { kind: "gap", id: "z", reason: "x", metadata } };

    expect(() => store.apply([...adds("c"), untrusted(hostile), ...adds("d")])).not.toThrow();
    expect(store.getStats().invalid).toBe(1);
    expect(store.get("z")).toBeUndefined();
    expect(state.ids).toEqual(["c", "d"]);
    expect(state.changes).toHaveLength(1);
  });

  it("notifies what a batch applied before its iteration threw, then rethrows", () => {
    const store = createViewerStore();
    const state = mirror(store);
    const failure = new Error("iteration");
    const batch = new Proxy(adds("a", "b"), {
      get(target, key, receiver) {
        if (key === "1") throw failure;
        return Reflect.get(target, key, receiver);
      },
    });

    expect(() => store.apply(batch)).toThrow(failure);
    expect(ids(store)).toEqual(["a"]);
    expect(store.version).toBe(1);
    expect(state.ids).toEqual(["a"]);
    store.apply(adds("c"));
    expect(state.ids).toEqual(["a", "c"]);
  });
});
