import { describe, expect, it } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type CorrelationChange,
  type Correlator,
  type EntryUpdate,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { correlatorInternals, createCorrelatorWith } from "../src/correlation.ts";
import { call, result } from "./correlation-fixtures.ts";
import { add, gap, unparsed } from "./store-fixtures.ts";

function connected(
  store: ViewerStore = createViewerStore(),
  correlator: Correlator = createCorrelator(),
): { store: ViewerStore; correlator: Correlator; changes: CorrelationChange[] } {
  const changes: CorrelationChange[] = [];
  correlator.subscribe((change) => changes.push(change));
  correlator.connect(store);
  return { store, correlator, changes };
}

function addAll(...entries: ViewerEntry[]): EntryUpdate[] {
  return entries.map(add);
}

describe("Correlator following a store", () => {
  it("correlates entries added after connect, one change per store change", () => {
    const { store, correlator, changes } = connected();

    store.apply(addAll(call("c1", "m1")));
    store.apply(addAll(result("r1", "m1")));

    expect(correlator.get("r1")).toMatchObject({ role: "response", callId: "c1" });
    expect(correlator.get("c1")).toMatchObject({ role: "call", responseId: "r1" });
    expect(changes).toEqual([
      { version: 1, changed: ["c1"], removed: [], cleared: false },
      { version: 2, changed: ["c1", "r1"], removed: [], cleared: false },
    ]);
    expect(correlator.version).toBe(2);
  });

  it("seeds from the listed entries, then follows the store", () => {
    const store = createViewerStore();
    store.load([call("c1", "m1")]);
    const { correlator } = connected(store);

    store.apply(addAll(result("r1", "m1")));

    expect(correlator.get("r1")).toMatchObject({ role: "response", callId: "c1" });
    expect(correlator.unansweredCalls()).toEqual([]);
  });

  it("correlates a CALL and its response added in the same batch", () => {
    const { store, correlator, changes } = connected();

    store.apply(addAll(call("c1", "m1"), result("r1", "m1")));

    expect(correlator.get("r1")).toMatchObject({ role: "response", callId: "c1" });
    expect(changes).toEqual([{ version: 1, changed: ["c1", "r1"], removed: [], cleared: false }]);
  });

  it("does not emit for a store change that correlates nothing", () => {
    const { store, correlator, changes } = connected();

    store.apply(addAll(unparsed("u1")));

    expect(changes).toEqual([]);
    expect(correlator.version).toBe(0);
  });

  it("does not re-correlate updated entries", () => {
    const { store, correlator, changes } = connected();
    store.apply(addAll(call("c1", "m1", { sessionId: "s1" })));

    store.apply([{ type: "update", id: "c1", metadata: { sessionId: "s2" } }]);
    store.apply(addAll(result("r1", "m1", { sessionId: "s1" })));

    expect(changes).toHaveLength(2);
    expect(correlator.get("r1")).toMatchObject({ role: "response", callId: "c1" });
  });

  it("depends only on the store stream, however it is batched", () => {
    // No filter or selection input exists: the correlator reads the store's
    // unfiltered list order, so the same stream gives the same results.
    const stream = [
      call("c1", "m1"),
      call("c2", "m1", { chargePointId: "CP-2" }),
      result("r1", "m1"),
      gap("g1"),
      result("r2", "m1", { chargePointId: "CP-2" }),
      result("r3", "m1"),
      call("c3", "m2"),
    ];
    const loaded = connected();
    loaded.store.load(stream);
    const single = connected();
    for (const entry of stream) single.store.apply([add(entry)]);
    const batched = connected();
    batched.store.apply(addAll(...stream.slice(0, 3)));
    batched.store.apply(addAll(...stream.slice(3)));

    for (const other of [single, batched]) {
      for (const { id } of stream)
        expect(other.correlator.get(id)).toEqual(loaded.correlator.get(id));
      expect(other.correlator.unansweredCalls()).toEqual(loaded.correlator.unansweredCalls());
      expect(other.correlator.orphanResponses()).toEqual(loaded.correlator.orphanResponses());
    }
    expect(loaded.correlator.get("r3")).toMatchObject({ role: "orphan", incompleteHistory: true });
  });

  it("reports the second answer to a mirrored CALL as an orphan with that candidate", () => {
    // A gateway mirrors one charger CALL to a primary and a secondary CSMS;
    // both answer in the same session.
    const { store, correlator } = connected();

    store.apply(addAll(call("c1", "m1", { sessionId: "s1" })));
    store.apply(addAll(result("primary", "m1", { sessionId: "s1" })));
    store.apply(addAll(result("secondary", "m1", { sessionId: "s1" })));

    expect(correlator.get("primary")).toMatchObject({ role: "response", callId: "c1" });
    expect(correlator.get("secondary")).toEqual({
      role: "orphan",
      messageId: "m1",
      candidates: ["c1"],
      candidatesTruncated: false,
      incompleteHistory: false,
    });
    expect(correlator.orphanResponses()).toEqual(["secondary"]);
  });
});

describe("Correlator and eviction", () => {
  it("drops evicted entries and reports those that had a correlation", () => {
    const { store, correlator, changes } = connected(createViewerStore({ maxEntries: 2 }));
    store.apply(addAll(call("c1", "m1"), unparsed("u1")));

    store.apply(addAll(call("c2", "m2"), call("c3", "m3")));

    expect(correlator.get("c1")).toBeUndefined();
    expect(correlator.unansweredCalls()).toEqual(["c2", "c3"]);
    expect(changes.at(-1)).toEqual({
      version: 2,
      changed: ["c2", "c3"],
      removed: ["c1"],
      cleared: false,
    });
  });

  it("keeps a response's CALL and action after the CALL is evicted", () => {
    const { store, correlator } = connected(createViewerStore({ maxEntries: 2 }));
    store.apply(addAll(call("c1", "m1", { action: "Reset" }), result("r1", "m1")));

    store.apply(addAll(call("c2", "m2")));

    expect(correlator.get("c1")).toBeUndefined();
    expect(correlator.get("r1")).toMatchObject({ role: "response", callId: "c1", action: "Reset" });
  });

  it("makes a response to an evicted CALL an orphan with an incomplete history", () => {
    const { store, correlator } = connected(createViewerStore({ maxEntries: 2 }));
    store.apply(addAll(call("c1", "m1"), call("c2", "m2")));

    store.apply(addAll(call("c3", "m3")));
    store.apply(addAll(result("r1", "m1")));

    expect(correlator.get("r1")).toEqual({
      role: "orphan",
      messageId: "m1",
      candidates: [],
      candidatesTruncated: false,
      incompleteHistory: true,
    });
    expect(correlator.unansweredCalls()).toEqual(["c3"]);
  });

  it("marks the history incomplete when an entry is added and evicted in one batch", () => {
    const { store, correlator, changes } = connected(createViewerStore({ maxEntries: 1 }));

    store.apply(addAll(call("c1", "m1"), result("r1", "m1")));

    expect(store.toArray().map(({ id }) => id)).toEqual(["r1"]);
    expect(correlator.get("r1")).toMatchObject({ role: "orphan", incompleteHistory: true });
    expect(changes).toEqual([{ version: 1, changed: ["r1"], removed: [], cleared: false }]);
  });

  it("starts with an incomplete history when the store evicted before connect", () => {
    const store = createViewerStore({ maxEntries: 1 });
    store.load([call("c0", "m0"), call("c1", "m1")]);
    const { correlator } = connected(store);

    store.apply(addAll(result("r0", "m0")));

    expect(correlator.get("r0")).toMatchObject({ role: "orphan", incompleteHistory: true });
  });

  it("keeps every index within the listed trace entries", () => {
    const store = createViewerStore({ maxEntries: 5 });
    const { correlator } = connected(store);

    for (let i = 0; i < 200; i += 1) {
      const id = `m${String(i % 7)}`;
      store.apply(addAll(i % 3 === 2 ? result(`r${String(i)}`, id) : call(`c${String(i)}`, id)));
      const sizes = correlatorInternals(correlator).indexSizes();
      expect(sizes.tracked).toBeLessThanOrEqual(store.size);
      expect(sizes.calls).toBeLessThanOrEqual(store.size);
      expect(sizes.unanswered).toBeLessThanOrEqual(store.size);
      expect(correlator.unansweredCalls().length).toBeLessThanOrEqual(store.size);
      expect(correlator.orphanResponses().length).toBeLessThanOrEqual(store.size);
    }
  });
});

describe("Correlator and store clear, pause and listeners", () => {
  it("resets everything when the store is cleared, including incompleteness", () => {
    const { store, correlator, changes } = connected(createViewerStore({ maxEntries: 1 }));
    store.apply(addAll(call("c1", "m1"), call("c2", "m2")));

    store.clear();
    store.apply(addAll(result("r2", "m2")));

    expect(correlator.get("c2")).toBeUndefined();
    expect(correlator.unansweredCalls()).toEqual([]);
    expect(correlator.get("r2")).toMatchObject({ role: "orphan", incompleteHistory: false });
    expect(changes.slice(1)).toEqual([
      { version: 2, changed: [], removed: [], cleared: true },
      { version: 3, changed: ["r2"], removed: [], cleared: false },
    ]);
  });

  it("correlates pending entries when the store resumes, in arrival order", () => {
    const { store, correlator, changes } = connected();
    store.pause();

    store.apply(addAll(call("c1", "m1")));
    store.apply(addAll(result("r1", "m1")));
    expect(correlator.get("c1")).toBeUndefined();
    expect(changes).toEqual([]);

    store.resume();

    expect(correlator.get("r1")).toMatchObject({ role: "response", callId: "c1" });
    expect(changes).toEqual([{ version: 1, changed: ["c1", "r1"], removed: [], cleared: false }]);
  });

  it("marks the history incomplete when pending entries were dropped", () => {
    const { store, correlator } = connected(createViewerStore({ maxEntries: 1 }));
    store.pause();
    store.apply(addAll(call("c1", "m1"), call("c2", "m2")));

    store.resume();
    store.apply(addAll(result("r1", "m1")));

    expect(correlator.get("r1")).toMatchObject({ role: "orphan", incompleteHistory: true });
  });

  it("never lets a listener error reach the store", () => {
    const reported: unknown[] = [];
    const correlator = createCorrelatorWith(undefined, (error) => reported.push(error));
    correlator.subscribe(() => {
      throw new Error("listener");
    });
    const store = createViewerStore();
    correlator.connect(store);
    const seen: number[] = [];
    store.subscribe((change) => seen.push(change.version));

    expect(() => store.apply(addAll(call("c1", "m1")))).not.toThrow();
    expect(seen).toEqual([1]);
    expect(reported).toEqual([new Error("listener")]);
    expect(correlator.get("c1")).toMatchObject({ role: "call" });
  });

  it("stops following the store once unsubscribed", () => {
    const store = createViewerStore();
    const correlator = createCorrelator();
    const unsubscribe = correlator.connect(store);
    store.apply(addAll(call("c1", "m1")));

    unsubscribe();
    store.apply(addAll(call("c2", "m2")));

    expect(correlator.get("c1")).toBeUndefined();
    expect(correlator.get("c2")).toBeUndefined();
    expect(correlator.unansweredCalls()).toEqual([]);
  });
});
