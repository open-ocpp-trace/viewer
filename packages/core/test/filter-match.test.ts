import { describe, expect, it } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type FilterFieldDefinition,
  type TraceEntry,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { compileFilter, type TraceFilter } from "../src/filter-model.ts";
import { all, context, record, select, simulator } from "./filter-fixtures.ts";
import { add, deepFreeze } from "./store-fixtures.ts";

describe("matchesFilter", () => {
  it.each<[string, TraceFilter, string[]]>([
    ["the empty filter", {}, ["s1", "s2", "s3", "s4", "s5", "g1", "g2"]],
    ["unparsed kind", { kinds: ["unparsed"] }, ["s4"]],
    ["gap kind", { kinds: ["gap"] }, ["s5"]],
    ["an empty kind list", { kinds: [] }, []],
    ["a charge point", { chargePointIds: ["CP-1"] }, ["s1", "s2", "s3", "s5"]],
    ["a metadata charge point", { chargePointIds: ["CP-7"] }, ["s5", "g1"]],
    ["a charge point the record overrides", { chargePointIds: ["CP-ignored"] }, ["s5"]],
    ["an absent charge point", { chargePointIds: [null] }, ["s4", "s5"]],
    ["an empty charge point list", { chargePointIds: [] }, ["s5"]],
    ["connector 0", { connectorIds: [0] }, ["s1", "s5"]],
    ["an absent connector", { connectorIds: [null] }, ["s3", "s4", "s5", "g1", "g2"]],
    ["an OCPP version", { ocppVersions: ["1.6"] }, ["s1", "s2", "s3", "s5"]],
    ["a version or none", { ocppVersions: ["2.0.1", null] }, ["s4", "s5", "g1", "g2"]],
    ["a direction", { directions: ["csms-to-cp"] }, ["s3", "s5"]],
    ["CALL", { messageTypes: ["CALL"] }, ["s1", "s2", "s5", "g1", "g2"]],
    ["CALL or none", { messageTypes: ["CALL", null] }, ["s1", "s2", "s4", "s5", "g1", "g2"]],
    ["an action", { actions: ["StatusNotification"] }, ["s2", "s5"]],
    ["an absent action", { actions: [null] }, ["s3", "s4", "s5"]],
    ["a message id", { messageIds: ["m-s2"] }, ["s2", "s3", "s5"]],
    ["a session", { sessionIds: ["sess-1"] }, ["s5", "g1"]],
    ["a tenant or none", { tenants: ["acme", null] }, ["s1", "s2", "s3", "s4", "s5", "g1"]],
    ["a source", { sourceIds: ["gw-us"] }, ["s5", "g2"]],
    ["any delivery status", { deliveryStatuses: ["failed"] }, ["s5", "g1"]],
    ["no delivery", { deliveryStatuses: [null] }, ["s1", "s2", "s3", "s4", "s5"]],
    ["two properties (AND)", { chargePointIds: ["CP-1"], connectorIds: [1] }, ["s2", "s5"]],
    [
      "a time range, from inclusive and to exclusive, compared as instants",
      { timeRange: { from: "2026-11-09T11:00:05+01:00", to: "2026-11-09T10:00:07.000Z" } },
      ["s2", "s3", "s5"],
    ],
    ["a range without bounds", { timeRange: {} }, ["s1", "s2", "s3", "s4", "s5", "g1", "g2"]],
  ])("selects by %s", (_, filter, expected) => {
    expect(select(filter)).toEqual(expected);
  });

  it("keeps gaps whatever the properties, but not when kinds exclude them", () => {
    const strict: TraceFilter = {
      chargePointIds: [],
      timeRange: { from: "2100-01-01T00:00:00Z" },
      fields: [{ id: "site", values: [] }],
    };
    const site: FilterFieldDefinition = { id: "site", label: "Site", values: () => ["x"] };
    expect(select(strict, all, context([site]))).toEqual(["s5"]);
    expect(select({ ...strict, kinds: ["trace"] }, all, context([site]))).toEqual([]);
  });

  it("reads values of the wrong runtime type as absent, never falling back", () => {
    const odd = [
      record("t1", { connectorId: "1", action: 42, chargePointId: 7 }, { chargePointId: "CP-7" }),
      record("t2", { connectorId: 1.5, ocppVersion: 16, messageId: 3, direction: 1 }),
      record("t3", { connectorId: -1, messageType: 2 }, { tenant: 1 as unknown as string }),
    ];
    expect(select({ connectorIds: [null] }, odd)).toEqual(["t1", "t2", "t3"]);
    expect(select({ connectorIds: [1] }, odd)).toEqual([]);
    expect(select({ actions: [null] }, odd)).toEqual(["t1"]);
    expect(select({ chargePointIds: [null] }, odd)).toEqual(["t1", "t2", "t3"]);
    expect(select({ ocppVersions: [null], messageIds: [null] }, odd)).toEqual(["t2"]);
    expect(select({ directions: [null], messageTypes: [null] }, odd)).toEqual([]);
    expect(select({ directions: [null] }, odd)).toEqual(["t2"]);
    expect(select({ messageTypes: [null], tenants: [null] }, odd)).toEqual(["t3"]);
  });

  it("never throws on a record whose getters throw", () => {
    const hostile = { ...record("h1").record };
    for (const key of ["chargePointId", "action", "timestamp", "connectorId"]) {
      Object.defineProperty(hostile, key, {
        enumerable: true,
        get() {
          throw new Error(key);
        },
      });
    }
    const entry = { kind: "trace", id: "h1", record: hostile } as unknown as TraceEntry;
    expect(
      select({ chargePointIds: [null], actions: [null], connectorIds: [null] }, [entry]),
    ).toEqual(["h1"]);
    expect(select({ timeRange: { from: "1970-01-01T00:00:00Z" } }, [entry])).toEqual([]);
  });

  it("places an entry in time by its record, its own timestamp, then receivedAt", () => {
    const entries: ViewerEntry[] = [
      record("t1", { timestamp: "2026-01-01T00:00:00Z" }, undefined, {
        receivedAt: "2020-01-01T00:00:00Z",
      }),
      record("t2", { timestamp: undefined }, undefined, { receivedAt: "2026-01-01T00:00:00Z" }),
      record("t3", { timestamp: 1 }, undefined, { receivedAt: "2026-01-01T00:00:00Z" }),
      record("t4", { timestamp: "not a date" }),
      { kind: "unparsed", id: "u1", raw: "", reason: "", receivedAt: "2026-01-01T00:00:00Z" },
      { kind: "unparsed", id: "u2", raw: "", reason: "" },
    ];
    expect(select({ timeRange: { from: "2025-01-01T00:00:00Z" } }, entries)).toEqual([
      "t1",
      "t2",
      "u1",
    ]);
    expect(select({ timeRange: { to: "2100-01-01T00:00:00Z" } }, entries)).toEqual([
      "t1",
      "t2",
      "u1",
    ]);
  });

  it("filters on the action derived by a correlator, without rewriting records", () => {
    const store = createViewerStore();
    const correlator = createCorrelator();
    correlator.connect(store);
    store.apply([add(simulator.status), add(simulator.result)]);
    const before = JSON.stringify(simulator.result.record);

    expect(select({ actions: ["StatusNotification"] }, all, context([], correlator))).toEqual([
      "s2",
      "s3",
      "s5",
    ]);
    expect(select({ actions: ["StatusNotification"] })).toEqual(["s2", "s5"]);
    expect(JSON.stringify(simulator.result.record)).toBe(before);
    expect(simulator.result.record.action).toBeUndefined();
  });

  it("filters on producer fields, containing definitions that misbehave", () => {
    const entries = [
      record("p1", {}, { custom: { site: "north" } }),
      record("p2", {}, { custom: { site: "south" } }),
      record("p3"),
    ];
    const site: FilterFieldDefinition = {
      id: "site",
      label: "Site",
      values: (entry) => {
        const value = entry.metadata?.custom?.["site"];
        return typeof value === "string" ? [value] : [];
      },
    };
    const throwing: FilterFieldDefinition = {
      id: "__proto__",
      label: "Throws",
      values: (entry) => {
        if (entry.id === "p1") throw new Error("boom");
        return entry.id === "p2" ? (["ok", 1, null] as unknown as string[]) : (7 as never);
      },
    };
    const ctx = context([site, throwing]);

    expect(select({ fields: [{ id: "site", values: ["north"] }] }, entries, ctx)).toEqual(["p1"]);
    expect(select({ fields: [{ id: "site", values: [null] }] }, entries, ctx)).toEqual(["p3"]);
    expect(select({ fields: [{ id: "__proto__", values: [null] }] }, entries, ctx)).toEqual([
      "p1",
      "p3",
    ]);
    expect(select({ fields: [{ id: "__proto__", values: ["ok"] }] }, entries, ctx)).toEqual(["p2"]);
  });

  it("treats __proto__ and constructor as plain values", () => {
    const entries = [
      record("u1", { chargePointId: "__proto__", action: "constructor" }),
      record("u2", { chargePointId: undefined }),
    ];
    expect(select({ chargePointIds: ["__proto__"] }, entries)).toEqual(["u1"]);
    expect(select({ chargePointIds: ["constructor", "toString"] }, entries)).toEqual([]);
    expect(select({ actions: ["constructor"] }, entries)).toEqual(["u1"]);
  });

  it("never mutates the entries it reads", () => {
    const entries = all.map((entry) =>
      deepFreeze(JSON.parse(JSON.stringify(entry)) as ViewerEntry),
    );
    const before = JSON.stringify(entries);
    select({ chargePointIds: ["CP-1"], deliveryStatuses: ["failed"], connectorIds: [0] }, entries);
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe("compileFilter", () => {
  const fields = context([{ id: "site", label: "Site", values: () => [] }]).fields;

  it.each<[string, unknown]>([
    ["a non-object filter", null],
    ["an unknown property", { chargePointId: ["CP-1"] }],
    ["a non-array list", { kinds: "trace" }],
    ["an unknown kind", { kinds: ["row"] }],
    ["a non-string value", { chargePointIds: [1] }],
    ["an undefined value", { actions: [undefined] }],
    ["a string connector", { connectorIds: ["1"] }],
    ["a fractional connector", { connectorIds: [1.5] }],
    ["a non-object range", { timeRange: "today" }],
    ["an unparsable bound", { timeRange: { from: "yesterday" } }],
    ["a non-string bound", { timeRange: { to: 0 } }],
    ["a non-array field list", { fields: { id: "site", values: [] } }],
    ["an unknown field id", { fields: [{ id: "zone", values: ["a"] }] }],
    ["a prototype field id", { fields: [{ id: "__proto__", values: ["a"] }] }],
    ["field values that are not a list", { fields: [{ id: "site", values: "a" }] }],
  ])("rejects %s with a RangeError", (_, filter) => {
    expect(() => compileFilter(filter as TraceFilter, fields)).toThrow(RangeError);
  });

  it("accepts an empty-string value as a real value", () => {
    expect(select({ chargePointIds: [""] }, [record("e1", { chargePointId: "" })])).toEqual(["e1"]);
  });
});
