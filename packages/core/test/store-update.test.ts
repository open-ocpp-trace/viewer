import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  type EntryMetadataPatch,
  type EntryUpdate,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { storeInternals } from "../src/store.ts";
import {
  add,
  adds,
  deepFreeze,
  ids,
  mirror,
  trace,
  traceRecord,
  unparsed,
} from "./store-fixtures.ts";

function update(id: string, metadata: EntryMetadataPatch, revision?: number): EntryUpdate {
  return revision === undefined
    ? { type: "update", id, metadata }
    : { type: "update", id, revision, metadata };
}

function metadata(store: ViewerStore, id: string): unknown {
  return store.get(id)?.metadata;
}

describe("ViewerStore updates", () => {
  it("merges a patch into a new entry that keeps the record, in place (rules 3, 4)", () => {
    const store = createViewerStore();
    const entry = deepFreeze(trace("a", { metadata: { tenant: "t1", sessionId: "s" } }));
    store.apply([add(entry), ...adds("b")]);
    store.apply([update("a", { tenant: "t2", chargePointId: "CP-9" })]);

    const updated = store.get("a");
    expect(updated).not.toBe(entry);
    expect(updated?.kind === "trace" && updated.record).toBe(entry.record);
    expect(updated?.metadata).toEqual({ tenant: "t2", sessionId: "s", chargePointId: "CP-9" });
    expect(entry.metadata).toEqual({ tenant: "t1", sessionId: "s" });
    expect(ids(store)).toEqual(["a", "b"]);
    expect(store.at(0)).toBe(updated);
  });

  it("ignores undefined values, stores null and never removes a field (rule 5)", () => {
    const store = createViewerStore();
    store.apply([add(trace("a", { metadata: { tenant: "t", custom: { x: 1, y: 2 } } }))]);
    const patch = { tenant: undefined, sessionId: null, custom: { x: undefined, y: null, z: 3 } };
    store.apply([update("a", patch as unknown as EntryMetadataPatch)]);

    expect(metadata(store, "a")).toEqual({
      tenant: "t",
      sessionId: null,
      custom: { x: 1, y: null, z: 3 },
    });
  });

  it("does not notify a patch whose values are all undefined", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    const entry = store.get("a");
    store.apply([
      update("a", { tenant: undefined, custom: undefined } as unknown as EntryMetadataPatch),
    ]);

    expect(store.version).toBe(1);
    expect(store.get("a")).toBe(entry);
  });

  it("merges custom per key into a null-prototype object", () => {
    const store = createViewerStore();
    store.apply([add(trace("a", { metadata: { custom: { kept: 1 } } }))]);
    const custom = JSON.parse('{"__proto__":{"polluted":true},"constructor":2}') as Record<
      string,
      unknown
    >;
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as EntryMetadataPatch;
    store.apply([update("a", { custom }), update("a", patch)]);

    const merged = store.get("a")?.metadata?.custom ?? {};
    expect(Object.getPrototypeOf(merged)).toBeNull();
    expect(Object.keys(merged)).toEqual(["kept", "__proto__", "constructor"]);
    expect(merged["constructor"]).toBe(2);
    expect(Object.hasOwn(store.get("a")?.metadata ?? {}, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("merges deliveries per target, replacing a delivery whole (rule 5)", () => {
    const store = createViewerStore();
    const deliveries = [
      { target: "p", role: "primary", status: "queued", reason: "link down" },
      { target: "s", status: "queued" },
    ];
    store.apply([add(trace("a", { metadata: { deliveries } }))]);
    store.apply([
      update("a", {
        deliveries: [
          { target: "p", status: "written" },
          { target: "n", status: "submitted" },
          { target: "n", status: "failed" },
        ],
      }),
    ]);

    expect(store.get("a")?.metadata?.deliveries).toEqual([
      { target: "p", status: "written" },
      { target: "s", status: "queued" },
      { target: "n", status: "failed" },
    ]);
  });

  it("applies revisions above the watermark only, counting stale ones (rule 1)", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    store.apply([
      update("a", { tenant: "r0" }, 0),
      update("a", { tenant: "r0 again" }, 0),
      update("a", { tenant: "r5" }, 5),
      update("a", { tenant: "r3" }, 3),
      update("a", { tenant: "none" }),
      update("a", { tenant: "r5 again" }, 5),
    ]);

    expect(metadata(store, "a")).toEqual({ tenant: "none" });
    expect(store.getStats().staleUpdates).toBe(3);
    store.apply([update("a", { tenant: "r6" }, 6)]);
    expect(metadata(store, "a")).toEqual({ tenant: "r6" });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "2", null])(
    "drops and counts an update with revision %s",
    (revision) => {
      const store = createViewerStore();
      store.apply(adds("a"));
      store.apply([
        { type: "update", id: "a", revision, metadata: { tenant: "t" } } as unknown as EntryUpdate,
      ]);

      expect(store.getStats().invalid).toBe(1);
      expect(metadata(store, "a")).toBeUndefined();
    },
  );

  it("counts an update for an unknown or evicted id, never resurrecting it (rules 2, 3)", () => {
    const store = createViewerStore({ maxEntries: 2 });
    store.apply(adds("a", "b", "c"));
    store.apply([update("a", { tenant: "t" }), update("z", { tenant: "t" })]);

    expect(ids(store)).toEqual(["b", "c"]);
    expect(store.get("a")).toBeUndefined();
    expect(store.getStats().unknownUpdates).toBe(2);
  });

  it("notifies updated listed ids, excluding added and evicted ones", () => {
    const store = createViewerStore({ maxEntries: 3 });
    store.apply(adds("a", "b", "c"));
    const state = mirror(store);
    store.apply([
      update("b", { tenant: "t" }),
      update("c", { tenant: "t" }),
      update("a", { tenant: "t" }),
      ...adds("d", "e"),
      update("d", { tenant: "t" }),
    ]);

    expect(state.changes).toEqual([
      { version: 2, added: ["d", "e"], updated: ["c"], evicted: ["a", "b"], cleared: false },
    ]);
    expect(state.ids).toEqual(ids(store));
  });

  it("re-weighs the metadata only and enforces the bound at once", () => {
    let reads = 0;
    const record = traceRecord("a");
    Object.defineProperty(record, "payload", {
      enumerable: true,
      get() {
        reads++;
        return {};
      },
    });
    const store = createViewerStore({ maxBytes: 20_000 });
    store.apply([add({ kind: "trace", id: "a", record }), add(unparsed("b")), add(unparsed("c"))]);
    const before = store.getStats().listedBytes;
    const state = mirror(store);
    store.apply([update("b", { custom: { blob: "x".repeat(4_900) } })]);

    expect(store.getStats().listedBytes).toBeGreaterThan(before + 9_000);
    store.apply([update("c", { custom: { blob: "x".repeat(4_900) } })]);

    expect(reads).toBe(1);
    expect(state.changes.at(-1)?.evicted).toEqual(["a"]);
    expect(state.changes.at(-1)?.updated).toEqual(["c"]);
    expect(store.getStats().listedBytes).toBeLessThanOrEqual(20_000);
    expect(store.getStats().evicted).toBe(1);
    expect(storeInternals(store).indexSize()).toBe(store.size);
  });

  it("treats metadata that is not an object on the entry as empty", () => {
    const store = createViewerStore();
    store.apply([add({ ...trace("a"), metadata: "junk" } as unknown as ReturnType<typeof trace>)]);
    store.apply([update("a", { tenant: "t" })]);

    expect(metadata(store, "a")).toEqual({ tenant: "t" });
  });
});
