import { describe, expect, it } from "vite-plus/test";

import { createViewerStore, STORE_ID_PREFIX, type ViewerStore } from "@open-ocpp-trace/viewer-core";

import { storeInternals } from "../src/store.ts";
import { add, adds, ids, mirror, unparsed } from "./store-fixtures.ts";

function expectIndexed(store: ViewerStore): void {
  const { listed, pending } = store.getStats();
  expect(storeInternals(store).indexSize()).toBe(listed + pending);
}

/** Adds unparsed entries of about 2 kB each. */
function bigAdds(...names: string[]) {
  return names.map((id) => add(unparsed(id, "x".repeat(1000))));
}

describe("ViewerStore pause", () => {
  it("queues adds while paused and lists them on resume", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    const state = mirror(store);
    store.pause();
    store.pause();
    store.apply(adds("b", "c"));

    expect(store.paused).toBe(true);
    expect(ids(store)).toEqual(["a"]);
    expect(store.get("b")?.id).toBe("b");
    expect([store.isPending("b"), store.isPending("a"), store.isPending("z")]).toEqual([
      true,
      false,
      false,
    ]);
    expect(store.indexOf("b")).toBe(-1);
    expect(store.getStats()).toMatchObject({ paused: true, listed: 1, pending: 2 });
    expect(store.getStats().pendingBytes).toBeGreaterThan(0);
    expectIndexed(store);

    store.resume();
    store.resume();

    expect(ids(store)).toEqual(["a", "b", "c"]);
    expect(store.indexOf("c")).toBe(2);
    expect(store.getStats()).toMatchObject({ paused: false, pending: 0, pendingBytes: 0 });
    expect(state.changes.map((change) => change.added)).toEqual([[], [], ["b", "c"]]);
    expect(store.version).toBe(4);
    expect(state.ids).toEqual(ids(store));
  });

  it("applies updates to listed and pending entries, and sees pending ids as held", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    store.pause();
    store.apply([
      ...adds("b", "b"),
      { type: "update", id: "a", metadata: { tenant: "t" } },
      { type: "update", id: "b", metadata: { tenant: "t" } },
    ]);

    expect(store.get("a")?.metadata?.tenant).toBe("t");
    expect(store.get("b")?.metadata?.tenant).toBe("t");
    expect(store.getStats()).toMatchObject({ duplicates: 1, unknownUpdates: 0 });
    store.resume();
    expect(store.at(1)?.metadata?.tenant).toBe("t");
  });

  it("drops the oldest pending entries past the limits, leaving the list as is", () => {
    const store = createViewerStore({ maxEntries: 3 });
    store.apply(adds("a", "b", "c"));
    store.pause();
    store.apply(adds("d", "e", "f", "g", "h"));

    expect(ids(store)).toEqual(["a", "b", "c"]);
    expect(store.getStats()).toMatchObject({ pending: 3, droppedPending: 2, evicted: 0 });
    expect(store.get("d")).toBeUndefined();
    expectIndexed(store);
    store.apply([{ type: "update", id: "d", metadata: { tenant: "t" } }, ...adds("e")]);
    expect(store.getStats()).toMatchObject({ unknownUpdates: 1, pending: 3, droppedPending: 3 });

    store.resume();

    // The gap and the oldest entries are evicted by the count bound.
    expect(ids(store)).toEqual(["g", "h", "e"]);
    expect(store.getStats().evicted).toBe(4);
    expectIndexed(store);
  });

  it("lists a store gap counting the entries dropped during this pause, then the survivors", () => {
    const store = createViewerStore({ maxBytes: 5_000 });
    store.pause();
    store.apply(bigAdds("p1", "p2", "p3", "p4"));
    expect(store.getStats()).toMatchObject({ pending: 2, droppedPending: 2 });
    store.resume();

    expect(store.toArray()[0]).toEqual({
      kind: "gap",
      id: `${STORE_ID_PREFIX}gap:1`,
      reason: "dropped",
      missedCount: 2,
    });
    expect(ids(store).slice(1)).toEqual(["p3", "p4"]);

    store.pause();
    store.apply(bigAdds("q1"));
    store.resume();
    expect(ids(store).at(-1)).toBe("q1");

    store.pause();
    store.apply(bigAdds("r1", "r2", "r3"));
    store.resume();
    expect(store.get(`${STORE_ID_PREFIX}gap:2`)).toMatchObject({ missedCount: 1 });
    expect(store.getStats().droppedPending).toBe(3);
  });

  it("keeps an oversized pending entry alone", () => {
    const store = createViewerStore({ maxBytes: 1_000 });
    store.pause();
    store.apply(bigAdds("a", "b"));

    expect(store.getStats()).toMatchObject({ pending: 1, droppedPending: 1 });
    expect(store.isPending("b")).toBe(true);
  });
});

describe("ViewerStore clear", () => {
  it("removes every entry and counter, keeping pause and the gap numbering", () => {
    const store = createViewerStore({ maxEntries: 3, maxBytes: 5_000 });
    store.apply([...adds("a", "b", "c", "d", "d"), null as never]);
    store.pause();
    store.apply(bigAdds("p1", "p2", "p3"));
    store.resume();
    expect(ids(store)).toEqual([`${STORE_ID_PREFIX}gap:1`, "p2", "p3"]);
    store.pause();
    store.apply(bigAdds("q1", "q2", "q3"));
    const state = mirror(store);
    store.clear();

    expect(state.changes).toEqual([
      { version: store.version, added: [], updated: [], evicted: [], cleared: true },
    ]);
    expect(state.ids).toEqual([]);
    expect(store.paused).toBe(true);
    expect(store.getStats()).toEqual({
      listed: 0,
      listedBytes: 0,
      pending: 0,
      pendingBytes: 0,
      paused: true,
      evicted: 0,
      droppedPending: 0,
      duplicates: 0,
      unknownUpdates: 0,
      staleUpdates: 0,
      invalid: 0,
    });
    expect(storeInternals(store).indexSize()).toBe(0);

    store.apply([{ type: "update", id: "b", metadata: { tenant: "t" } }]);
    store.resume();
    store.apply(adds("b"));
    // No gap for the entries dropped before the clear.
    expect(ids(store)).toEqual(["b"]);
    expect(store.indexOf("b")).toBe(0);
    expect(store.getStats().unknownUpdates).toBe(1);

    store.pause();
    store.apply(bigAdds("x", "y", "z"));
    store.resume();
    expect(ids(store)).toEqual([`${STORE_ID_PREFIX}gap:2`, "y", "z"]);
    expect(state.ids).toEqual(ids(store));
  });
});
