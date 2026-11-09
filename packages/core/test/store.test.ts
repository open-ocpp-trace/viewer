import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  type EntryUpdate,
  STORE_ID_PREFIX,
  type ViewerStoreOptions,
} from "@open-ocpp-trace/viewer-core";

import { storeInternals } from "../src/store.ts";
import { add, adds, deepFreeze, gap, ids, trace, unparsed } from "./store-fixtures.ts";

describe("createViewerStore options", () => {
  it("uses the default limits", () => {
    expect(DEFAULT_MAX_ENTRIES).toBe(10_000);
    expect(DEFAULT_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(() => createViewerStore()).not.toThrow();
    // A JavaScript caller may pass explicit undefined values.
    const unset = { maxEntries: undefined, maxBytes: undefined } as unknown as ViewerStoreOptions;
    expect(() => createViewerStore(unset)).not.toThrow();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "10" as unknown as number])(
    "rejects %s as a limit with a RangeError",
    (value) => {
      expect(() => createViewerStore({ maxEntries: value })).toThrow(RangeError);
      expect(() => createViewerStore({ maxBytes: value })).toThrow(RangeError);
    },
  );
});

describe("ViewerStore ingestion", () => {
  it("lists added entries in arrival order with stable ids", () => {
    const store = createViewerStore();
    const first = trace("a");
    store.apply([add(first), add(unparsed("b")), add(gap("c"))]);
    store.apply(adds("d"));

    expect(store.size).toBe(4);
    expect(ids(store)).toEqual(["a", "b", "c", "d"]);
    expect(store.at(0)).toBe(first);
    expect(store.get("a")).toBe(first);
    expect(store.indexOf("a")).toBe(0);
    expect(store.indexOf("d")).toBe(3);
    expect(store.at(3)?.id).toBe("d");
  });

  it("returns nothing for unknown ids and out-of-range indexes", () => {
    const store = createViewerStore();
    store.apply(adds("a", "b"));

    expect(store.get("z")).toBeUndefined();
    expect(store.indexOf("z")).toBe(-1);
    for (const index of [-1, 2, 1.5, Number.NaN]) {
      expect(store.at(index)).toBeUndefined();
    }
  });

  it("loads a snapshot as adds, before later batches", () => {
    const store = createViewerStore();
    store.load([trace("s1"), trace("s2")]);
    store.apply(adds("b1"));

    expect(ids(store)).toEqual(["s1", "s2", "b1"]);
  });

  it("returns a copy from toArray", () => {
    const store = createViewerStore();
    store.apply(adds("a"));
    const copy = store.toArray() as unknown[];
    copy.length = 0;

    expect(ids(store)).toEqual(["a"]);
  });

  it("ignores and counts a duplicate add, keeping the first entry in place (rule 6)", () => {
    const store = createViewerStore();
    const first = trace("a");
    store.apply([add(first), add(trace("b")), add(trace("a"))]);
    store.load([trace("b")]);

    expect(ids(store)).toEqual(["a", "b"]);
    expect(store.get("a")).toBe(first);
    expect(store.getStats().duplicates).toBe(2);
  });

  it("never mutates the entries or records it receives", () => {
    const store = createViewerStore();
    const entry = deepFreeze(
      trace("a", {
        metadata: {
          deliveries: [
            { target: "t1", status: "queued" },
            { target: "t1", status: "written" },
          ],
          custom: { nested: { value: 1 } },
        },
      }),
    );

    expect(() => store.apply([add(entry)])).not.toThrow();
    expect(store.get("a")?.kind).toBe("trace");
  });
});

describe("ViewerStore untrusted data", () => {
  it("drops and counts malformed items, still applying the rest of the batch", () => {
    const store = createViewerStore();
    const batch = [
      null,
      42,
      "add",
      { type: "remove", id: "a" },
      { type: "add" },
      { type: "add", entry: null },
      { type: "add", entry: { kind: "log", id: "x" } },
      { type: "add", entry: { kind: "trace", id: 7, record: {} } },
      { type: "update", id: 7, metadata: {} },
      { type: "update", id: "a", metadata: null },
      { type: "update", id: "a", metadata: "tenant" },
      { type: "update", id: "a", metadata: [] },
      add(trace("ok")),
    ] as unknown as EntryUpdate[];

    store.apply(batch);

    expect(ids(store)).toEqual(["ok"]);
    expect(store.getStats().invalid).toBe(12);
  });

  it("treats __proto__, constructor and hasOwnProperty as plain ids", () => {
    const store = createViewerStore();
    const names = ["__proto__", "constructor", "hasOwnProperty"];
    store.apply(adds(...names));
    store.apply(adds(...names));

    expect(ids(store)).toEqual(names);
    for (const [index, id] of names.entries()) {
      expect(store.get(id)?.id).toBe(id);
      expect(store.indexOf(id)).toBe(index);
    }
    expect(store.getStats().duplicates).toBe(3);
    expect(store.indexOf("toString")).toBe(-1);
  });

  it("keeps a custom __proto__ key as data without touching Object.prototype", () => {
    const store = createViewerStore();
    const custom = JSON.parse('{"__proto__":{"polluted":true},"constructor":1}') as Record<
      string,
      unknown
    >;
    store.apply([add(trace("a", { metadata: { custom } }))]);

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.hasOwn(store.get("a")?.metadata?.custom ?? {}, "__proto__")).toBe(true);
  });

  it("keeps the last delivery of a duplicate target in an add, at its first position (rule 5)", () => {
    const store = createViewerStore();
    const entry = trace("a", {
      metadata: {
        tenant: "t",
        deliveries: [
          { target: "csms", status: "queued" },
          { target: "proxy", status: "submitted" },
          { target: "csms", status: "written", role: "primary" },
        ],
      },
    });
    const before = structuredClone(entry);
    store.apply([add(entry)]);

    const stored = store.get("a");
    expect(stored?.metadata).toEqual({
      tenant: "t",
      deliveries: [
        { target: "csms", status: "written", role: "primary" },
        { target: "proxy", status: "submitted" },
      ],
    });
    expect(stored).not.toBe(entry);
    expect(stored?.kind === "trace" && stored.record).toBe(entry.record);
    expect(entry).toEqual(before);
  });

  it("stores an entry without duplicate targets as is", () => {
    const store = createViewerStore();
    const entry = trace("a", {
      metadata: { deliveries: [{ target: "csms", status: "queued" }] },
    });
    const odd = trace("b", { metadata: { deliveries: "csms" as unknown as [] } });
    store.apply([add(entry), add(odd)]);

    expect(store.get("a")).toBe(entry);
    expect(store.get("b")).toBe(odd);
  });

  it("drops and counts an add with a reserved id", () => {
    const store = createViewerStore();
    store.apply([add(trace(`${STORE_ID_PREFIX}gap:1`)), ...adds("a")]);

    expect(ids(store)).toEqual(["a"]);
    expect(store.getStats().invalid).toBe(1);
  });

  it("keeps its index the size of the listed entries", () => {
    const store = createViewerStore();
    store.apply([...adds("a", "b"), ...adds("a")]);

    expect(storeInternals(store).indexSize()).toBe(store.size);
  });
});
