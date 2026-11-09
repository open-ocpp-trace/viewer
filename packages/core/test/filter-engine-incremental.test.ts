import { describe, expect, it } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type EntryDelivery,
  type EntryMetadata,
  type EntryUpdate,
  type FilterEngine,
  type FilterFieldDefinition,
  type TraceFilter,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { cachedSize, createFilterEngineWith } from "../src/filter-engine.ts";
import { computeStats } from "../src/filter-stats.ts";
import { frame } from "./correlation-fixtures.ts";
import { context, select } from "./filter-fixtures.ts";

/** Mulberry32: a small seeded generator, so a failing seed replays. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const zone: FilterFieldDefinition = {
  id: "zone",
  label: "Zone",
  values: (entry) => {
    const tenant = entry.metadata?.tenant;
    return tenant === undefined ? [] : [`${tenant}-zone`, "any"];
  },
};

function run(
  seed: number,
  order: "before" | "after",
  steps: number,
): { partial: number; membershipByUpdate: number; countsOnly: number } {
  const random = generator(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const maybe = <T>(items: readonly T[]): T | undefined =>
    random() < 0.3 ? undefined : pick(items);

  const store = createViewerStore({ maxEntries: 8 });
  const correlator = createCorrelator();
  const reported: unknown[] = [];
  const engine = createFilterEngineWith({ fields: [zone], correlator }, (error) =>
    reported.push(error),
  );
  let disconnect: (() => void) | undefined;
  if (order === "before") disconnect = correlator.connect(store);
  engine.connect(store);
  if (order === "after") disconnect = correlator.connect(store);
  const ctx = context([zone], correlator);

  let next = 0;
  const seen: string[] = [];

  function deliveries(): EntryDelivery[] {
    return [{ target: random() < 0.9 ? "a" : "b", status: pick(["written", "failed", "queued"]) }];
  }

  function metadata(): EntryMetadata {
    const tenant = maybe(["acme", "__proto__", ""]);
    const sessionId = maybe(["s1", "s2"]);
    const chargePointId = maybe(["CP-2", "CP-3"]);
    return {
      ...(tenant !== undefined && { tenant }),
      ...(sessionId !== undefined && { sessionId }),
      ...(chargePointId !== undefined && { chargePointId }),
      ...(random() < 0.5 && { source: { id: pick(["gw-eu", "gw-us"]) } }),
      ...(random() < 0.5 && { deliveries: deliveries() }),
    };
  }

  function entry(): ViewerEntry {
    const id = random() < 0.05 && seen.length > 0 ? pick(seen) : `e${(next += 1)}`;
    seen.push(id);
    const roll = random();
    if (roll < 0.1) return { kind: "gap", id, reason: "disconnected" };
    if (roll < 0.2) return { kind: "unparsed", id, raw: "x", reason: "bad", metadata: metadata() };
    const messageType = pick(["CALL", "CALL", "CALLRESULT", "CALLERROR"] as const);
    const base = frame(id, messageType, pick(["m1", "m2", "m3"]), {
      chargePointId: pick(["CP-1", null]),
      ...(messageType === "CALL" && { action: pick(["Heartbeat", "Authorize"]) }),
    });
    return { ...base, metadata: metadata() };
  }

  function filter(): TraceFilter {
    const all: TraceFilter = {
      kinds: [pick(["trace", "unparsed", "gap"] as const), pick(["trace", "gap"] as const)],
      actions: [pick(["Heartbeat", "Authorize"]), pick([null, "Heartbeat"])],
      deliveryStatuses: [pick(["failed", "written", null])],
      tenants: [pick(["acme", "__proto__", "", null])],
      chargePointIds: [pick(["CP-1", "CP-2", null])],
      messageTypes: [pick(["CALL", "CALLRESULT", null])],
      fields: [{ id: "zone", values: [pick(["acme-zone", "any", null])] }],
      text: pick(["cp-1", "heart", "e1", "  "]),
    };
    // Favour the properties a metadata update can change.
    const updatable = new Set(["deliveryStatuses", "tenants", "fields"]);
    const chosen = Object.entries(all).filter(
      ([key]) => random() < (updatable.has(key) ? 0.5 : 0.1),
    );
    return Object.fromEntries(chosen) as TraceFilter;
  }

  /** Runs one random operation; true for a metadata update. */
  function step(): boolean {
    const roll = random();
    if (roll < 0.4) {
      store.apply(Array.from({ length: 1 + Math.floor(random() * 3) }, () => add(entry())));
    } else if (roll < 0.65) {
      const listed = store.toArray().map((entry) => entry.id);
      const id =
        random() < 0.8 && listed.length > 0
          ? pick(listed)
          : random() < 0.2
            ? "unknown"
            : (pick(seen) ?? "unknown");
      const patch = random() < 0.6 ? { deliveries: deliveries() } : metadata();
      const update: EntryUpdate = {
        type: "update",
        id,
        metadata: patch,
        ...(random() < 0.3 && { revision: Math.floor(random() * 4) }),
      };
      store.apply([update]);
      return true;
    } else if (roll < 0.75) {
      if (store.paused) store.resume();
      else store.pause();
    } else if (roll < 0.78) {
      store.clear();
    } else if (roll < 0.8) {
      if (disconnect === undefined) {
        disconnect = correlator.connect(store);
      } else {
        disconnect();
        disconnect = undefined;
      }
    } else if (roll < 0.95) {
      engine.setFilter(filter());
    } else {
      engine.reset();
    }
    return false;
  }

  /** Steps showing the run exercises what it claims to. */
  const coverage = { partial: 0, membershipByUpdate: 0, countsOnly: 0 };
  let previous = snapshot(engine);
  for (let index = 0; index < steps; index += 1) {
    const version = engine.version;
    const stats = engine.getStats();
    const updated = step();
    const current = snapshot(engine);
    const label = `seed ${seed}, ${order}, step ${index}`;

    const entries = store.toArray();
    expect(current.ids, label).toEqual(select(engine.filter, entries, ctx));
    expect(stats === engine.getStats(), label).toBe(engine.version === version);
    expect(current.stats.buffer, label).toEqual(
      computeStats(entries, { fields: [zone], correlator }),
    );
    const matching = new Set(current.ids);
    expect(current.stats.filtered, label).toEqual(
      computeStats(
        entries.filter((entry) => matching.has(entry.id)),
        { fields: [zone], correlator },
      ),
    );
    expect(cachedSize(engine), label).toBe(store.size);
    current.ids.forEach((id, at) => expect(engine.indexOf(id), label).toBe(at));
    if (engine.version === version) {
      expect(current, `${label}: changed without a notification`).toEqual(previous);
    }
    if (current.ids.length > 0 && current.ids.length < entries.length) coverage.partial += 1;
    if (updated && engine.version !== version) {
      const sameIds = current.ids.join("\n") === previous.ids.join("\n");
      if (sameIds) coverage.countsOnly += 1;
      else coverage.membershipByUpdate += 1;
    }
    previous = current;
  }
  expect(reported).toEqual([]);
  return coverage;
}

function add(entry: ViewerEntry): EntryUpdate {
  return { type: "add", entry };
}

function snapshot(engine: FilterEngine): {
  ids: string[];
  stats: ReturnType<FilterEngine["getStats"]>;
} {
  const ids: string[] = [];
  for (let index = 0; index < engine.size; index += 1) ids.push(engine.at(index)!.id);
  return { ids, stats: engine.getStats() };
}

describe("FilterEngine incremental maintenance", () => {
  it.each([
    [1, "before"],
    [1, "after"],
    [7, "before"],
    [7, "after"],
    [42, "before"],
    [42, "after"],
    [2026, "before"],
    [2026, "after"],
  ] as const)(
    "matches a full recomputation after every step (seed %i, correlator %s)",
    (seed, order) => {
      const coverage = run(seed, order, 300);
      expect(coverage.partial).toBeGreaterThan(30);
      expect(coverage.membershipByUpdate).toBeGreaterThan(0);
      expect(coverage.countsOnly).toBeGreaterThan(0);
    },
  );
});
