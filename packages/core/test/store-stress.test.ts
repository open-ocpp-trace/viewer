import { describe, expect, it } from "vite-plus/test";

import type { TraceRecord } from "@open-ocpp-trace/core";
import {
  createViewerStore,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  STORE_ID_PREFIX,
  type EntryUpdate,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { coreWeight } from "../src/store-estimate.ts";
import { storeInternals } from "../src/store.ts";
import { add, ids, mirror, trace, traceRecord, unparsed } from "./store-fixtures.ts";

/** The compaction rule of the slot queues bounds their backing arrays by this. */
const backingBound = (limit: number): number => Math.max(1024, limit) + limit + 1;

/** The weight of the gap `resume` lists, kept out of the pending budget. */
const resumeGapWeight = (maxBytes: number, gapNumber = 1): number =>
  coreWeight(
    { kind: "gap", id: `${STORE_ID_PREFIX}gap:${gapNumber}`, reason: "dropped", missedCount: 0 },
    maxBytes,
  );

/**
 * The invariants every run must leave, whatever the load, against the
 * configured limits.
 */
function expectBounded(store: ViewerStore, maxEntries: number, maxBytes: number): void {
  const stats = store.getStats();
  const internals = storeInternals(store);
  expect(stats.listed).toBe(store.size);
  expect(store.size).toBeLessThanOrEqual(maxEntries);
  if (store.size > 1) expect(stats.listedBytes).toBeLessThanOrEqual(maxBytes);
  expect(stats.pending).toBeLessThanOrEqual(Math.max(1, maxEntries - 1));
  if (stats.pending > 1) {
    expect(stats.pendingBytes).toBeLessThanOrEqual(maxBytes - resumeGapWeight(maxBytes));
  }
  expect(internals.indexSize()).toBe(stats.listed + stats.pending);
  expect(internals.backingLength()).toBeLessThanOrEqual(backingBound(maxEntries));
  expect(internals.pendingBackingLength()).toBeLessThanOrEqual(backingBound(maxEntries));
}

/** `count` adds of small entries named `<prefix><n>`, in batches of `size`. */
function* batches(prefix: string, count: number, size: number): Generator<EntryUpdate[]> {
  for (let start = 0; start < count; start += size) {
    const batch: EntryUpdate[] = [];
    for (let n = start; n < Math.min(count, start + size); n++) {
      batch.push(add(unparsed(`${prefix}${n}`)));
    }
    yield batch;
  }
}

const range = (prefix: string, from: number, to: number): string[] =>
  Array.from({ length: to - from }, (_, n) => `${prefix}${from + n}`);

describe("ViewerStore under load", () => {
  it("keeps 100k adds through a small capacity bounded and exact", () => {
    const store = createViewerStore({ maxEntries: 50 });
    const state = mirror(store);
    for (const batch of batches("e", 100_000, 100)) store.apply(batch);

    expect(ids(store)).toEqual(range("e", 99_950, 100_000));
    expect(store.getStats().evicted).toBe(99_950);
    expect(store.indexOf("e99950")).toBe(0);
    expect(store.get("e99949")).toBeUndefined();
    expect(state.ids).toEqual(ids(store));
    expect(store.version).toBe(1_000);
    expectBounded(store, 50, DEFAULT_MAX_BYTES);
  });

  it("bounds multi-MB frames by bytes and keeps an oversized one alone", () => {
    const maxBytes = 1024 * 1024;
    const store = createViewerStore({ maxBytes });
    const frame = (id: string, chars: number) => add(unparsed(id, "x".repeat(chars)));

    // About 600 kB each: only one fits at a time.
    for (let n = 0; n < 20; n++) store.apply([frame(`m${n}`, 300_000)]);
    expect(ids(store)).toEqual(["m19"]);
    expect(store.getStats().evicted).toBe(19);
    expectBounded(store, DEFAULT_MAX_ENTRIES, maxBytes);

    // About 200 kB each: five fit.
    for (let n = 0; n < 10; n++) store.apply([frame(`s${n}`, 100_000)]);
    expect(ids(store)).toEqual(range("s", 5, 10));
    expect(store.getStats().evicted).toBe(25);

    // About 8 MB on its own: kept alone, then evicted by the next add.
    store.apply([frame("huge", 4_000_000)]);
    expect(ids(store)).toEqual(["huge"]);
    expect(store.getStats().listedBytes).toBeGreaterThan(maxBytes);
    store.apply([frame("next", 10)]);
    expect(ids(store)).toEqual(["next"]);
    expect(store.getStats().evicted).toBe(31);

    store.pause();
    store.apply([frame("p1", 100_000), frame("p2", 4_000_000)]);
    expect(store.getStats()).toMatchObject({ pending: 1, droppedPending: 1 });
    expect(store.isPending("p2")).toBe(true);
    expectBounded(store, DEFAULT_MAX_ENTRIES, maxBytes);
  });

  it("re-weighs only the metadata on update bursts over large payloads", () => {
    let reads = 0;
    const big = "y".repeat(500_000);
    const record = (id: string): TraceRecord => {
      const payload = {};
      Object.defineProperty(payload, "data", {
        enumerable: true,
        get() {
          reads++;
          return big;
        },
      });
      return { ...traceRecord(id), payload } as TraceRecord;
    };
    const store = createViewerStore({ maxEntries: 10 });
    store.apply(
      Array.from({ length: 10 }, (_, n) => add(trace(`t${n}`, { record: record(`t${n}`) }))),
    );
    expect(reads).toBe(10);
    const coreBytes = store.getStats().listedBytes;

    for (let round = 0; round < 1_000; round++) {
      store.apply(
        Array.from({ length: 10 }, (_, n) => ({
          type: "update" as const,
          id: `t${n}`,
          revision: round,
          metadata: { custom: { round } },
        })),
      );
    }

    expect(reads).toBe(10);
    expect(store.get("t3")?.metadata?.custom).toEqual({ round: 999 });
    expect(store.getStats()).toMatchObject({ listed: 10, staleUpdates: 0, evicted: 0 });
    expect(store.getStats().listedBytes).toBeGreaterThan(coreBytes);
    expectBounded(store, 10, DEFAULT_MAX_BYTES);
  });

  it("bounds a paused overflow at high rate and lists the gap on resume", () => {
    const maxBytes = 1024 * 1024;
    const store = createViewerStore({ maxEntries: 100, maxBytes });
    for (const batch of batches("a", 100, 100)) store.apply(batch);
    store.pause();
    for (const batch of batches("p", 50_000, 500)) store.apply(batch);

    expect(ids(store)).toEqual(range("a", 0, 100));
    expect(store.getStats()).toMatchObject({ pending: 99, droppedPending: 49_901, evicted: 0 });
    expectBounded(store, 100, maxBytes);

    const state = mirror(store);
    store.resume();

    const gapId = `${STORE_ID_PREFIX}gap:1`;
    expect(ids(store)).toEqual([gapId, ...range("p", 49_901, 50_000)]);
    expect(store.get(gapId)).toMatchObject({ reason: "dropped", missedCount: 49_901 });
    expect(store.getStats()).toMatchObject({ pending: 0, evicted: 100 });
    expect(state.ids).toEqual(ids(store));
    expectBounded(store, 100, maxBytes);
  });

  it("applies single-item batches at default capacity in constant time each", () => {
    const store = createViewerStore();
    for (const batch of batches("f", DEFAULT_MAX_ENTRIES, 1_000)) store.apply(batch);
    expect(store.size).toBe(DEFAULT_MAX_ENTRIES);

    // A consumer in O(1) per change, so the timing measures the store alone.
    const mirrored = ids(store);
    let head = 0;
    store.subscribe((change) => {
      for (const id of change.evicted) {
        if (mirrored[head++] !== id) throw new Error(`evicted ${id} is not the front`);
      }
      for (const id of change.added) mirrored.push(id);
    });
    const started = performance.now();
    for (let n = 0; n < 10_000; n++) store.apply([add(unparsed(`s${n}`))]);
    const elapsed = performance.now() - started;

    expect(mirrored.slice(head)).toEqual(range("s", 0, 10_000));
    expect(ids(store)).toEqual(range("s", 0, 10_000));
    expect(store.version).toBe(10 + 10_000);
    expectBounded(store, DEFAULT_MAX_ENTRIES, DEFAULT_MAX_BYTES);
    // About 10 ms here; a copy of the list per batch took about 1.7 s.
    expect(elapsed).toBeLessThan(500);
  });

  it("keeps room for the resume gap when bytes bound a paused overflow", () => {
    // Bytes bind, not the count: exactly 99 tail entries and the gap fit.
    const entryWeight = coreWeight(unparsed("p49999"), DEFAULT_MAX_BYTES);
    const maxBytes = 99 * entryWeight + resumeGapWeight(DEFAULT_MAX_BYTES);
    const store = createViewerStore({ maxBytes });
    store.apply([add(unparsed("a0"))]);
    store.pause();
    for (const batch of batches("p", 50_000, 500)) store.apply(batch);

    expect(store.getStats()).toMatchObject({
      pending: 99,
      pendingBytes: 99 * entryWeight,
      droppedPending: 49_901,
    });
    expectBounded(store, DEFAULT_MAX_ENTRIES, maxBytes);

    const state = mirror(store);
    store.resume();

    const gapId = `${STORE_ID_PREFIX}gap:1`;
    expect(ids(store)).toEqual([gapId, ...range("p", 49_901, 50_000)]);
    expect(store.getStats()).toMatchObject({ listedBytes: maxBytes, evicted: 1 });
    expect(state.ids).toEqual(ids(store));
    expectBounded(store, DEFAULT_MAX_ENTRIES, maxBytes);
  });
});
