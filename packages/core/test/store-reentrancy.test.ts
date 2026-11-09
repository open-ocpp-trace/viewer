import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  type EntryUpdate,
  type ViewerAdapter,
} from "@open-ocpp-trace/viewer-core";

import { add, adds, gap, ids, mirror } from "./store-fixtures.ts";

describe("ViewerStore reentrancy", () => {
  it("runs an apply made by a listener after the notification, in version order", () => {
    const store = createViewerStore();
    const first: number[] = [];
    const second: number[] = [];
    store.subscribe((change) => {
      first.push(change.version);
      if (change.version === 1) {
        store.apply(adds("r"));
        // Queued: it returns before it has applied.
        expect(ids(store)).toEqual(["a"]);
      }
    });
    store.subscribe((change) => second.push(change.version));
    const state = mirror(store);
    store.apply(adds("a"));

    expect(first).toEqual([1, 2]);
    expect(second).toEqual([1, 2]);
    expect(ids(store)).toEqual(["a", "r"]);
    expect(state.ids).toEqual(ids(store));
    expect(state.changes.map((change) => change.added)).toEqual([["a"], ["r"]]);
  });

  it("runs an apply made while reading a batch item as its own later change", () => {
    const store = createViewerStore({ maxEntries: 2 });
    store.apply([add(gap("a")), add(gap("b"))]);
    const state = mirror(store);
    const item = {
      type: "add",
      get entry() {
        store.apply([add(gap("n1"))]);
        return gap("c");
      },
    };
    store.apply([add(gap("x")), item as unknown as EntryUpdate]);

    expect(ids(store)).toEqual(["c", "n1"]);
    expect(state.ids).toEqual(ids(store));
    expect(state.changes).toEqual([
      { version: 2, added: ["x", "c"], updated: [], evicted: ["a", "b"], cleared: false },
      { version: 3, added: ["n1"], updated: [], evicted: ["x"], cleared: false },
    ]);
    expect(store.getStats().evicted).toBe(3);
  });

  it("queues nested pause, apply, resume and clear in call order", () => {
    const store = createViewerStore();
    const state = mirror(store);
    const seen: boolean[] = [];
    let nested = true;
    store.subscribe(() => {
      if (!nested) return;
      nested = false;
      store.pause();
      seen.push(store.paused);
      store.apply(adds("p"));
      store.resume();
      store.pause();
      store.clear();
      store.apply(adds("q"));
    });
    store.apply(adds("a"));

    // The nested pause had not applied when the listener read it.
    expect(seen).toEqual([false]);
    expect(state.changes.map((change) => [change.version, change.added, change.cleared])).toEqual([
      [1, ["a"], false],
      [2, [], false],
      [3, [], false],
      [4, ["p"], false],
      [5, [], false],
      [6, [], true],
      [7, [], false],
    ]);
    expect(store.paused).toBe(true);
    expect(store.isPending("q")).toBe(true);
    expect(ids(store)).toEqual([]);
    expect(state.ids).toEqual(ids(store));
  });

  it("evaluates a queued pause or resume when it runs, not when it is called", () => {
    const store = createViewerStore();
    let nested = true;
    store.subscribe(() => {
      if (!nested) return;
      nested = false;
      // Both no-ops at call time; the pause applies before the resume runs.
      store.pause();
      store.resume();
    });
    store.apply(adds("a"));

    expect(store.paused).toBe(false);
    expect(store.version).toBe(3);
  });

  it("rethrows from the outer call an error raised while a queued change notifies", () => {
    const store = createViewerStore();
    const failure = new Error("listener");
    store.subscribe((change) => {
      if (change.version === 1) store.apply(adds("r"));
      if (change.version === 2) throw failure;
    });
    const seen: number[] = [];
    store.subscribe((change) => seen.push(change.version));

    expect(() => store.apply(adds("a"))).toThrow(failure);
    expect(ids(store)).toEqual(["a", "r"]);
    expect(seen).toEqual([1, 2]);

    store.apply(adds("b"));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("queues a synchronous snapshot of a connect made by a listener", () => {
    const store = createViewerStore();
    const state = mirror(store);
    let forward: ((batch: readonly EntryUpdate[]) => void) | undefined;
    const adapter: ViewerAdapter = {
      snapshot: () => [gap("s")],
      subscribe(listener) {
        forward = listener;
        return () => {
          forward = undefined;
        };
      },
    };
    let nested = true;
    store.subscribe(() => {
      if (!nested) return;
      nested = false;
      store.connect(adapter);
      expect(ids(store)).toEqual(["a"]);
    });
    store.apply(adds("a"));
    forward?.(adds("live"));

    expect(ids(store)).toEqual(["a", "s", "live"]);
    expect(state.ids).toEqual(ids(store));
  });

  it("keeps the outer error first when a queued change also fails", () => {
    const store = createViewerStore();
    const outer = new Error("outer");
    store.subscribe((change) => {
      if (change.version === 1) {
        store.apply(adds("r"));
        throw outer;
      }
      throw new Error("inner");
    });

    expect(() => store.apply(adds("a"))).toThrow(outer);
    expect(ids(store)).toEqual(["a", "r"]);
  });
});
