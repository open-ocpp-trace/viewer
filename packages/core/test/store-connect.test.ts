import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  STORE_ID_PREFIX,
  type EntryUpdate,
  type ViewerAdapter,
  type ViewerEntry,
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

  it("ignores a snapshot rejected after unsubscribe, without an unhandled rejection", async () => {
    const store = createViewerStore();
    const snapshot = deferred<readonly ViewerEntry[]>();
    const unsubscribe = store.connect(fakeAdapter(() => snapshot.promise).adapter);
    unsubscribe();

    snapshot.reject(new Error("late"));
    // Let an unhandled rejection, if any, reach the test runner.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.version).toBe(0);
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
});
