import { describe, expect, it } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type FilterFieldDefinition,
  type UnparsedEntry,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { compileFilter, type TraceFilter } from "../src/filter-model.ts";
import { SEARCH_BUDGET } from "../src/filter-search.ts";
import { all, context, record, select, simulator } from "./filter-fixtures.ts";
import { add, deepFreeze } from "./store-fixtures.ts";

const secret = record(
  "e1",
  {
    messageType: "CALLERROR",
    direction: "csms-to-cp",
    action: undefined,
    chargePointId: "CP-9",
    ocppVersion: "2.1",
    messageId: "mid-42",
    payload: { idTag: "secret-payload", amount: 98765 },
    raw: "secret-raw",
    meta: { token: "secret-meta" },
    error: {
      code: "SecurityError",
      description: "secret-description",
      details: { token: "secret-details" },
    },
  },
  {
    tenant: "tenant-x",
    sessionId: "session-x",
    conversationId: "conversation-x",
    source: { id: "source-x", label: "Label X" },
    deliveries: [{ target: "target-x", status: "dropped-x" }],
    custom: { token: "secret-custom", site: "site-x" },
  },
);

const frame = deepFreeze<UnparsedEntry>({
  kind: "unparsed",
  id: "u1",
  raw: "secret-unparsed",
  reason: "Reason U",
});

const site: FilterFieldDefinition = {
  id: "site",
  label: "Site",
  values: (entry) => {
    const value = entry.metadata?.custom?.["site"];
    return typeof value === "string" ? [value] : [];
  },
};

const entries: readonly ViewerEntry[] = [secret, frame, simulator.gap];

function search(text: string, payloads = false, data: readonly ViewerEntry[] = entries): string[] {
  return select({ text, searchPayloads: payloads }, data, context([site]), payloads);
}

describe("text search", () => {
  it.each([
    ["entry id", "E1"],
    ["message id", "MID-42"],
    ["charge point", "cp-9"],
    ["OCPP version", "2.1"],
    ["message type", "callerror"],
    ["direction", "CSMS-TO"],
    ["error code", "securityerror"],
    ["session", "session-x"],
    ["tenant", "tenant-x"],
    ["conversation", "conversation-x"],
    ["source id", "source-x"],
    ["source label", "label x"],
    ["delivery target", "target-x"],
    ["delivery status", "dropped-x"],
    ["producer field", "site-x"],
  ])("matches the %s by default, ignoring case and keeping gaps", (_, text) => {
    expect(search(`  ${text} `)).toEqual(["e1", "s5"]);
  });

  it("matches an unparsed entry's reason", () => {
    expect(search("reason u")).toEqual(["u1", "s5"]);
  });

  it("matches the action derived by a correlator", () => {
    const store = createViewerStore();
    const correlator = createCorrelator();
    correlator.connect(store);
    store.apply([add(simulator.status), add(simulator.result)]);
    const ctx = context([], correlator);
    expect(select({ text: "statusnotif" }, all, ctx)).toEqual(["s2", "s3", "s5"]);
  });

  it("treats blank text as no constraint", () => {
    expect(search("   ")).toEqual(["e1", "u1", "s5"]);
  });

  it.each([
    ["payload", "secret-payload"],
    ["payload number", "8765"],
    ["record raw", "secret-raw"],
    ["unparsed raw", "secret-unparsed"],
    ["error description", "secret-description"],
    ["error details", "secret-details"],
  ])("searches the %s only when both the engine and the filter opt in", (_, text) => {
    expect(search(text)).toEqual(["s5"]);
    expect(select({ text }, entries, context([site]), true)).toEqual(["s5"]);
    expect(search(text, true)).toHaveLength(2);
  });

  it.each([
    ["record meta", "secret-meta"],
    ["metadata custom", "secret-custom"],
  ])("never searches the %s, even with payload search", (_, text) => {
    expect(search(text)).toEqual(["s5"]);
    expect(search(text, true)).toEqual(["s5"]);
  });

  it.each<[string, unknown]>([
    ["payload search the engine lacks", { text: "x", searchPayloads: true }],
    ["a non-string text", { text: 1 }],
    ["a non-boolean opt-in", { searchPayloads: "yes" }],
  ])("rejects %s with a RangeError", (_, filter) => {
    expect(() => compileFilter(filter as TraceFilter, new Map())).toThrow(RangeError);
  });
});

describe("payload search limits", () => {
  /** Not frozen: freezing would trip the hostile values under test. */
  function payload(id: string, value: unknown): ViewerEntry {
    return { ...record(id), record: { ...record(id).record, payload: value } } as ViewerEntry;
  }

  function found(value: unknown, text = "needle"): boolean {
    return search(text, true, [payload("p", value)]).includes("p");
  }

  it("scans a budget of characters per entry, missing what lies beyond", () => {
    expect(found({ head: "needle", tail: "a".repeat(1_000_000) })).toBe(true);
    expect(found({ head: "a".repeat(1_000_000), tail: "needle" })).toBe(false);
    expect(found(["x".repeat(70_000) + "needle"])).toBe(false);
  });

  it("charges every node, so a huge object stays bounded", () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 200_000; i += 1) wide[`k${i}`] = "";
    wide["last"] = "needle";
    expect(found(wide)).toBe(false);
    expect(found([...Array.from({ length: 200_000 }, () => 0), "needle"])).toBe(false);
  });

  it("stops at a depth cap", () => {
    let deep: unknown = "needle";
    for (let i = 0; i < 1_000; i += 1) deep = { deep };
    expect(found(deep)).toBe(false);
    let shallow: unknown = "needle";
    for (let i = 0; i < 5; i += 1) shallow = [shallow];
    expect(found(shallow)).toBe(true);
  });

  it("survives cycles and throwing getters", () => {
    const cycle: Record<string, unknown> = { name: "loop" };
    cycle["self"] = cycle;
    cycle["list"] = [cycle, cycle];
    Object.freeze(cycle);
    expect(found(cycle)).toBe(false);
    expect(found(cycle, "loop")).toBe(true);

    const hostile = {};
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    const keys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("keys");
        },
      },
    );
    expect(found([hostile, keys, "needle"])).toBe(true);
    expect(found([hostile, keys])).toBe(false);
  });

  it("walks a huge array by index, never listing its keys", () => {
    const items: unknown[] = Array.from({ length: 1_000_000 }, () => 0);
    items[999_999] = "needle";
    let listed = 0;
    let reads = 0;
    const counted = new Proxy(items, {
      ownKeys(target) {
        listed += 1;
        return Reflect.ownKeys(target);
      },
      get(target, key, receiver) {
        reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    // Counting reads bounds the walk deterministically, unlike a wall clock.
    expect(found(counted)).toBe(false);
    expect(listed).toBe(0);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(SEARCH_BUDGET + 1);
    expect(found(items)).toBe(false);
    expect(found(["a", ["b", "needle"]])).toBe(true);
  });

  it("survives a hostile array length or item", () => {
    const length = new Proxy(["needle"], {
      get(target, key, receiver) {
        if (key === "length") throw new Error("length");
        return Reflect.get(target, key, receiver);
      },
    });
    const item = new Proxy(["x", "needle"], {
      get(target, key, receiver) {
        if (key === "0") throw new Error("item");
        return Reflect.get(target, key, receiver);
      },
    });
    expect(found([length, "tail"])).toBe(false);
    expect(found([length, "needle"])).toBe(true);
    expect(found(item)).toBe(true);
  });
});
