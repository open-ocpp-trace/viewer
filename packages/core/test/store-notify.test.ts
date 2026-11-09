import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  type EntryUpdate,
  type ViewerStoreChange,
} from "@open-ocpp-trace/viewer-core";

import { add, adds, ids, mirror, trace, unparsed } from "./store-fixtures.ts";

function changes(store: ReturnType<typeof createViewerStore>): ViewerStoreChange[] {
  const seen: ViewerStoreChange[] = [];
  store.subscribe((change) => seen.push(change));
  return seen;
}

describe("ViewerStore notifications", () => {
  it("notifies once per batch with the added ids", () => {
    const store = createViewerStore();
    const seen = changes(store);
    store.apply(adds("a", "b"));
    store.load([trace("c")]);

    expect(seen).toEqual([
      { version: 1, added: ["a", "b"], updated: [], evicted: [], cleared: false },
      { version: 2, added: ["c"], updated: [], evicted: [], cleared: false },
    ]);
    expect(store.version).toBe(2);
  });

  it("does not notify nor bump the version when nothing changed", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    const seen = changes(store);
    store.apply([]);
    store.load([]);
    store.apply([{ type: "update", id: "a", metadata: {} }]);

    expect(seen).toEqual([]);
    expect(store.version).toBe(1);
  });

  it.each<[string, EntryUpdate[], "duplicates" | "invalid" | "unknownUpdates"]>([
    ["a duplicate add", adds("a"), "duplicates"],
    ["an invalid item", [null as unknown as EntryUpdate], "invalid"],
    ["an unknown update", [{ type: "update", id: "z", metadata: {} }], "unknownUpdates"],
  ])("notifies an empty delta when only a counter changed: %s", (_, batch, counter) => {
    const store = createViewerStore();
    store.apply(adds("a"));
    const seen = changes(store);
    store.apply(batch);

    expect(seen).toEqual([{ version: 2, added: [], updated: [], evicted: [], cleared: false }]);
    expect(store.getStats()[counter]).toBe(1);
  });

  it("reports evictions from the front, oldest first", () => {
    const store = createViewerStore({ maxEntries: 3 });
    store.apply(adds("a", "b", "c"));
    const seen = changes(store);
    store.apply(adds("d", "e"));

    expect(seen).toEqual([
      { version: 2, added: ["d", "e"], updated: [], evicted: ["a", "b"], cleared: false },
    ]);
  });

  it("leaves out an id added and evicted in the same batch, but counts it", () => {
    const store = createViewerStore({ maxEntries: 2 });
    store.apply(adds("a", "b"));
    const seen = changes(store);
    store.apply(adds("c", "d", "e"));

    expect(seen[0]).toMatchObject({ added: ["d", "e"], evicted: ["a", "b"] });
    expect(store.getStats().evicted).toBe(3);
  });

  it("reports an id evicted then re-added in one batch in both lists", () => {
    const store = createViewerStore({ maxEntries: 2 });
    store.apply(adds("x", "y"));
    const seen = changes(store);
    store.apply(adds("z", "x"));

    expect(seen[0]).toMatchObject({ added: ["z", "x"], evicted: ["x", "y"] });
    expect(ids(store)).toEqual(["z", "x"]);
  });

  it("reports an id added, evicted and re-added in one batch once", () => {
    const store = createViewerStore({ maxEntries: 1 });
    const seen = changes(store);
    store.apply(adds("x", "y", "x"));

    expect(seen[0]).toMatchObject({ added: ["x"], evicted: [] });
    expect(store.getStats().evicted).toBe(2);
  });

  it("lets a consumer rebuild the list from the changes alone", () => {
    const store = createViewerStore({ maxEntries: 7, maxBytes: 20_000 });
    const copy = mirror(store);
    let next = 0;
    for (let batch = 0; batch < 200; batch++) {
      const items: EntryUpdate[] = [];
      for (let i = 0; i < batch % 13; i++) {
        const id = `e${next++}`;
        if (i % 5 === 4) items.push(add(unparsed(id, "x".repeat(i * 3000))));
        else if (i % 7 === 6) items.push(add(trace(`e${next - 3}`)));
        else items.push(add(trace(id)));
      }
      store.apply(items);

      expect(copy.ids).toEqual(ids(store));
    }
    expect(copy.changes.length).toBeGreaterThan(100);
  });
});

describe("ViewerStore stats", () => {
  it("returns the same object until the version changes", () => {
    const store = createViewerStore({ maxEntries: 2 });
    const initial = store.getStats();
    expect(store.getStats()).toBe(initial);
    expect(initial).toMatchObject({ listed: 0, listedBytes: 0, evicted: 0, paused: false });

    store.apply([]);
    expect(store.getStats()).toBe(initial);

    store.apply(adds("a", "b", "c"));
    const next = store.getStats();
    expect(next).not.toBe(initial);
    expect(store.getStats()).toBe(next);
    expect(next).toMatchObject({ listed: 2, evicted: 1, pending: 0, droppedPending: 0 });
    expect(initial.listed).toBe(0);
  });
});

describe("ViewerStore listeners", () => {
  it("calls listeners in subscription order with a consistent state", () => {
    const store = createViewerStore();
    const calls: string[] = [];
    store.subscribe((change) => calls.push(`1:${change.version}:${store.version}:${store.size}`));
    store.subscribe(() => calls.push(`2:${store.getStats().listed}`));
    store.apply(adds("a"));

    expect(calls).toEqual(["1:1:1:1", "2:1"]);
  });

  it("runs every listener when one throws, reporting each error instead of rethrowing", () => {
    const reported: unknown[] = [];
    const store = createViewerStore({ onError: (error) => reported.push(error) });
    const first = new Error("first");
    const second = new Error("second");
    const calls: number[] = [];
    store.subscribe(() => {
      calls.push(1);
      throw first;
    });
    store.subscribe(() => {
      calls.push(2);
      throw second;
    });
    store.subscribe(() => calls.push(3));

    expect(() => store.apply(adds("a"))).not.toThrow();
    expect(reported).toEqual([first, second]);
    expect(calls).toEqual([1, 2, 3]);
    expect(store.version).toBe(1);
    expect(ids(store)).toEqual(["a"]);
  });

  it("unsubscribes idempotently, and each subscription on its own", () => {
    const store = createViewerStore();
    const calls: number[] = [];
    const listener = (): void => {
      calls.push(store.version);
    };
    const first = store.subscribe(listener);
    store.subscribe(listener);
    first();
    first();
    store.apply(adds("a"));

    expect(calls).toEqual([1]);
  });

  it("skips a listener unsubscribed during a notification, not one added during it", () => {
    const store = createViewerStore();
    const calls: string[] = [];
    let late: (() => void) | undefined;
    store.subscribe(() => {
      calls.push("first");
      late?.();
      store.subscribe(() => calls.push("added"));
    });
    late = store.subscribe(() => calls.push("late"));
    store.apply(adds("a"));

    expect(calls).toEqual(["first"]);
  });
});
