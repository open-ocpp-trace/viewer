import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createViewerStore,
  STORE_ID_PREFIX,
  type EntryUpdate,
  type ViewerAdapter,
  type ViewerEntry,
  type ViewerErrorHandler,
} from "@open-ocpp-trace/viewer-core";

import { adds, ids, mirror, trace } from "./store-fixtures.ts";

type Snapshot = ReturnType<ViewerAdapter["snapshot"]>;

/** An adapter whose batches the test emits, recording its subscriptions. */
function fakeAdapter(snapshot: () => Snapshot) {
  const listeners = new Set<(updates: readonly EntryUpdate[]) => void>();
  let unsubscribed = 0;
  const adapter: ViewerAdapter = {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        unsubscribed++;
        listeners.delete(listener);
      };
    },
  };
  return {
    adapter,
    emit(batch: readonly EntryUpdate[]) {
      for (const listener of listeners) listener(batch);
    },
    get listeners() {
      return listeners.size;
    },
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const entries = (...names: string[]): ViewerEntry[] => names.map((id) => trace(id));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ViewerStore connect", () => {
  it("applies a synchronous snapshot before returning, then forwards batches", () => {
    const store = createViewerStore();
    const fake = fakeAdapter(() => entries("a", "b"));
    const state = mirror(store);

    store.connect(fake.adapter);
    expect(ids(store)).toEqual(["a", "b"]);

    fake.emit(adds("c"));
    expect(ids(store)).toEqual(["a", "b", "c"]);
    expect(state.changes.map((change) => change.added)).toEqual([["a", "b"], ["c"]]);
  });

  it("subscribes first and replays the batches received before the snapshot, in order", () => {
    const store = createViewerStore();
    let fake: ReturnType<typeof fakeAdapter>;
    fake = fakeAdapter(() => {
      // Emitted while the snapshot is taken: buffered, the overlap is a duplicate.
      fake.emit(adds("b", "c"));
      fake.emit(adds("d"));
      return entries("a", "b");
    });

    store.connect(fake.adapter);

    expect(ids(store)).toEqual(["a", "b", "c", "d"]);
    expect(store.getStats().duplicates).toBe(1);
  });

  it("applies a promised snapshot when it resolves, after the buffered batches arrive", async () => {
    const store = createViewerStore();
    const snapshot = deferred<readonly ViewerEntry[]>();
    const fake = fakeAdapter(() => snapshot.promise);
    store.connect(fake.adapter);
    fake.emit(adds("b"));
    fake.emit(adds("c"));
    expect(ids(store)).toEqual([]);

    snapshot.resolve(entries("a", "b"));
    await snapshot.promise;
    await Promise.resolve();

    expect(ids(store)).toEqual(["a", "b", "c"]);
    fake.emit(adds("d"));
    expect(ids(store)).toEqual(["a", "b", "c", "d"]);
  });

  it("lists a store gap when the snapshot rejects, then replays the buffer", async () => {
    const store = createViewerStore();
    store.pause();
    store.apply(adds("p1", "p2"));
    store.resume();
    const snapshot = deferred<readonly ViewerEntry[]>();
    const fake = fakeAdapter(() => snapshot.promise);
    store.connect(fake.adapter);
    fake.emit(adds("x"));

    snapshot.reject(new Error("offline"));
    await snapshot.promise.catch(() => undefined);
    await Promise.resolve();

    const gapId = `${STORE_ID_PREFIX}gap:1`;
    expect(ids(store)).toEqual(["p1", "p2", gapId, "x"]);
    expect(store.get(gapId)).toEqual({ kind: "gap", id: gapId, reason: "unknown" });
    expect(store.getStats().invalid).toBe(0);
  });

  it("lists a store gap when the snapshot is not an array", async () => {
    const store = createViewerStore();
    const fake = fakeAdapter(() => Promise.resolve(null as never));
    store.connect(fake.adapter);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.toArray()).toEqual([
      { kind: "gap", id: `${STORE_ID_PREFIX}gap:1`, reason: "unknown" },
    ]);
  });

  it("shares the gap numbering with resume", () => {
    const store = createViewerStore({ maxEntries: 3 });
    store.connect(fakeAdapter(() => undefined as never).adapter);
    store.pause();
    store.apply(adds("a", "b", "c"));
    store.resume();

    expect(ids(store)).toEqual([`${STORE_ID_PREFIX}gap:2`, "b", "c"]);
  });

  it("stops everything on unsubscribe, including a pending snapshot", async () => {
    const store = createViewerStore();
    const snapshot = deferred<readonly ViewerEntry[]>();
    const fake = fakeAdapter(() => snapshot.promise);
    const unsubscribe = store.connect(fake.adapter);
    fake.emit(adds("x"));

    unsubscribe();
    unsubscribe();
    expect(fake.unsubscribed).toBe(1);
    expect(fake.listeners).toBe(0);

    snapshot.resolve(entries("a"));
    await snapshot.promise;
    await Promise.resolve();
    expect(ids(store)).toEqual([]);
    expect(store.version).toBe(0);
  });

  it("ignores a snapshot rejected after unsubscribe, reporting nothing", async () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const store = createViewerStore({ onError });
    const snapshot = deferred<readonly ViewerEntry[]>();
    const unsubscribe = store.connect(fakeAdapter(() => snapshot.promise).adapter);
    unsubscribe();

    snapshot.reject(new Error("late"));
    // Let an unhandled rejection, if any, reach the test runner.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.version).toBe(0);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores batches a misbehaving adapter emits after unsubscribe", () => {
    const store = createViewerStore();
    let late: ((updates: readonly EntryUpdate[]) => void) | undefined;
    const unsubscribe = store.connect({
      snapshot: () => [],
      subscribe(listener) {
        late = listener;
        return () => undefined;
      },
    });
    unsubscribe();
    late?.(adds("a"));

    expect(ids(store)).toEqual([]);
  });

  it("counts the overlap of a reconnect as duplicates", () => {
    const store = createViewerStore();
    const first = fakeAdapter(() => entries("a", "b"));
    const unsubscribe = store.connect(first.adapter);
    first.emit([{ type: "add", entry: { kind: "gap", id: "lost", reason: "disconnected" } }]);
    unsubscribe();

    store.connect(fakeAdapter(() => entries("a", "b", "c")).adapter);

    expect(ids(store)).toEqual(["a", "b", "lost", "c"]);
    expect(store.getStats().duplicates).toBe(2);
  });

  it("unsubscribes and rethrows when the snapshot throws synchronously", () => {
    const store = createViewerStore();
    const fake = fakeAdapter(() => {
      throw new Error("boom");
    });

    expect(() => store.connect(fake.adapter)).toThrow("boom");
    expect(fake.unsubscribed).toBe(1);
    fake.emit(adds("a"));
    expect(store.version).toBe(0);
  });

  it("rethrows when subscribe throws, without taking the snapshot", () => {
    const store = createViewerStore();
    let snapshots = 0;
    const adapter: ViewerAdapter = {
      snapshot: () => {
        snapshots++;
        return [];
      },
      subscribe() {
        throw new Error("refused");
      },
    };

    expect(() => store.connect(adapter)).toThrow("refused");
    expect(snapshots).toBe(0);
    expect(store.version).toBe(0);
  });

  describe("with a listener that throws", () => {
    /** Subscribes a listener that throws on its first call only. */
    const throwOnce = (store: ReturnType<typeof createViewerStore>, message: string) => {
      let thrown = false;
      store.subscribe(() => {
        if (thrown) return;
        thrown = true;
        throw new Error(message);
      });
    };

    it("reports it and keeps forwarding after a synchronous snapshot", () => {
      const onError = vi.fn<ViewerErrorHandler>();
      const store = createViewerStore({ onError });
      throwOnce(store, "boom");
      let fake: ReturnType<typeof fakeAdapter>;
      fake = fakeAdapter(() => {
        fake.emit(adds("b"));
        fake.emit(adds("c"));
        return entries("a");
      });

      expect(() => store.connect(fake.adapter)).not.toThrow();
      expect(ids(store)).toEqual(["a", "b", "c"]);
      expect(onError.mock.calls).toEqual([
        [new Error("boom"), { component: "store", callback: "listener" }],
      ]);

      fake.emit(adds("d"));
      expect(ids(store)).toEqual(["a", "b", "c", "d"]);
      expect(fake.unsubscribed).toBe(0);
    });

    it("reports it and keeps forwarding after a promised snapshot", async () => {
      const onError = vi.fn<ViewerErrorHandler>();
      const store = createViewerStore({ onError });
      throwOnce(store, "boom-async");
      const fake = fakeAdapter(() => Promise.resolve(entries("a")));
      store.connect(fake.adapter);
      fake.emit(adds("b"));

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(ids(store)).toEqual(["a", "b"]);
      expect(onError.mock.calls).toEqual([
        [new Error("boom-async"), { component: "store", callback: "listener" }],
      ]);
      fake.emit(adds("c"));
      expect(ids(store)).toEqual(["a", "b", "c"]);
      expect(fake.unsubscribed).toBe(0);
    });
  });

  describe("with a snapshot whose reading throws", () => {
    /** An array whose second element cannot be read. */
    const hostileSnapshot = (failure: Error): ViewerEntry[] =>
      new Proxy(entries("a", "b"), {
        get(target, key, receiver) {
          if (key === "1") throw failure;
          return Reflect.get(target, key, receiver);
        },
      });

    it("unsubscribes and rethrows for a synchronous snapshot, keeping what was applied", () => {
      const onError = vi.fn<ViewerErrorHandler>();
      const store = createViewerStore({ onError });
      const failure = new Error("unreadable");
      const fake = fakeAdapter(() => hostileSnapshot(failure));

      expect(() => store.connect(fake.adapter)).toThrow(failure);
      expect(ids(store)).toEqual(["a"]);
      expect(fake.unsubscribed).toBe(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it("reports it for a promised snapshot, and keeps forwarding", async () => {
      const onError = vi.fn<ViewerErrorHandler>();
      const store = createViewerStore({ onError });
      const failure = new Error("unreadable");
      const fake = fakeAdapter(() => Promise.resolve(hostileSnapshot(failure)));
      store.connect(fake.adapter);
      fake.emit(adds("c"));

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(ids(store)).toEqual(["a", "c"]);
      expect(onError.mock.calls).toEqual([[failure, { component: "store", callback: "snapshot" }]]);
      fake.emit(adds("d"));
      expect(ids(store)).toEqual(["a", "c", "d"]);
    });

    it("reports it to the default reporter without onError", async () => {
      const reportError = vi.fn();
      vi.stubGlobal("reportError", reportError);
      const store = createViewerStore();
      const failure = new Error("unreadable");
      store.connect(fakeAdapter(() => Promise.resolve(hostileSnapshot(failure))).adapter);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(reportError.mock.calls).toEqual([[failure]]);
    });
  });

  describe("buffering before the snapshot", () => {
    const dropped = (n: number) => `${STORE_ID_PREFIX}gap:${n}`;

    it("keeps at most maxEntries - 1 buffered items, and lists a gap for the dropped adds", async () => {
      const store = createViewerStore({ maxEntries: 10 });
      const snapshot = deferred<readonly ViewerEntry[]>();
      const fake = fakeAdapter(() => snapshot.promise);
      store.connect(fake.adapter);
      for (let i = 0; i < 1000; i++) fake.emit(adds(`b${i}`));

      snapshot.resolve([]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const kept = Array.from({ length: 9 }, (_, i) => `b${991 + i}`);
      expect(ids(store)).toEqual([dropped(1), ...kept]);
      expect(store.get(dropped(1))).toEqual({
        kind: "gap",
        id: dropped(1),
        reason: "dropped",
        missedCount: 991,
      });
    });

    it("drops the oldest batches whole and lists the gap after the snapshot", async () => {
      const store = createViewerStore({ maxEntries: 6 });
      const state = mirror(store);
      const snapshot = deferred<readonly ViewerEntry[]>();
      const fake = fakeAdapter(() => snapshot.promise);
      store.connect(fake.adapter);
      fake.emit([{ type: "update", id: "s", metadata: { tenant: "t" } }]);
      fake.emit(adds("x1", "x2"));
      fake.emit(adds("y1", "y2"));
      fake.emit(adds("z1", "z2"));

      snapshot.resolve(entries("s"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ids(store)).toEqual(["s", dropped(1), "y1", "y2", "z1", "z2"]);
      expect(store.get(dropped(1))).toMatchObject({ missedCount: 2 });
      expect(store.get("s")?.metadata).toBeUndefined();
      expect(state.changes.map((change) => change.added)).toEqual([
        ["s"],
        [dropped(1)],
        ["y1", "y2"],
        ["z1", "z2"],
      ]);
    });

    it("lists the gap even when only updates were dropped", async () => {
      const store = createViewerStore({ maxEntries: 3 });
      const snapshot = deferred<readonly ViewerEntry[]>();
      const fake = fakeAdapter(() => snapshot.promise);
      store.connect(fake.adapter);
      fake.emit([{ type: "update", id: "s", metadata: { tenant: "t" } }]);
      fake.emit(adds("a", "b"));

      snapshot.resolve(entries("s"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ids(store)).toEqual([dropped(1), "a", "b"]);
      expect(store.get(dropped(1))).toMatchObject({ reason: "dropped", missedCount: 0 });
    });

    it("keeps the newest batch even when it alone exceeds the cap", async () => {
      const store = createViewerStore({ maxEntries: 3 });
      const snapshot = deferred<readonly ViewerEntry[]>();
      const fake = fakeAdapter(() => snapshot.promise);
      store.connect(fake.adapter);
      fake.emit(adds("a"));
      fake.emit(adds("b", "c", "d"));

      snapshot.resolve([]);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The store bounds the batch on apply: the gap is evicted.
      expect(ids(store)).toEqual(["b", "c", "d"]);
      expect(store.getStats().evicted).toBe(1);
    });
  });

  describe("with an untrusted thenable", () => {
    it("settles once when the thenable calls back several times", async () => {
      const store = createViewerStore();
      const thenable = {
        // oxlint-disable-next-line unicorn/no-thenable -- the hostile thenable under test
        then(onFulfilled: (value: unknown) => void, onRejected: (reason: unknown) => void) {
          onFulfilled(entries("a"));
          onFulfilled(entries("b"));
          onRejected(new Error("late"));
        },
      };
      store.connect(fakeAdapter(() => thenable as never).adapter);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ids(store)).toEqual(["a"]);
      expect(store.version).toBe(1);
    });

    it("lists a store gap when then throws", async () => {
      const store = createViewerStore();
      const thenable = {
        // oxlint-disable-next-line unicorn/no-thenable -- the hostile thenable under test
        then() {
          throw new Error("hostile");
        },
      };
      const fake = fakeAdapter(() => thenable as never);
      store.connect(fake.adapter);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(ids(store)).toEqual([`${STORE_ID_PREFIX}gap:1`]);
      expect(fake.unsubscribed).toBe(0);
    });
  });
});
