import { describe, expect, it } from "vite-plus/test";

import type {
  Correlator,
  FilterFieldDefinition,
  UnparsedEntry,
  ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { computeStats } from "../src/filter-stats.ts";
import { all, gateway, record, simulator } from "./filter-fixtures.ts";

const derived: Pick<Correlator, "get"> = {
  get: (id) =>
    id === "s3"
      ? {
          role: "response",
          messageId: "m-s2",
          callId: "s2",
          action: "StatusNotification",
          candidates: [],
          candidatesTruncated: false,
        }
      : undefined,
};

describe("computeStats", () => {
  it("counts nothing for no entries, every declared field present", () => {
    const zone: FilterFieldDefinition = { id: "zone", label: "Zone", values: () => [] };
    const stats = computeStats([], { fields: [zone] });

    expect(stats.total).toBe(0);
    expect(stats.kinds).toEqual({ trace: 0, unparsed: 0, gap: 0 });
    expect(stats.chargePointIds.size).toBe(0);
    expect(stats.deliveryStatuses.size).toBe(0);
    expect(stats.fields).toEqual(new Map([["zone", new Map()]]));
  });

  it("counts observed values per entry, absent values under null", () => {
    const stats = computeStats(all);

    expect(stats.total).toBe(7);
    expect(stats.kinds).toEqual({ trace: 5, unparsed: 1, gap: 1 });
    expect(stats.chargePointIds).toEqual(
      new Map<string | null, number>([
        ["CP-1", 3],
        [null, 2],
        ["CP-7", 1],
        ["CP-8", 1],
      ]),
    );
    expect(stats.connectorIds).toEqual(
      new Map<number | null, number>([
        [0, 1],
        [1, 1],
        [null, 5],
      ]),
    );
    expect(stats.directions).toEqual(
      new Map<string | null, number>([
        ["cp-to-csms", 5],
        ["csms-to-cp", 1],
        [null, 1],
      ]),
    );
    expect(stats.messageTypes.get(null)).toBe(2);
    expect(stats.ocppVersions.get("2.0.1")).toBe(2);
    expect(stats.tenants).toEqual(
      new Map<string | null, number>([
        [null, 5],
        ["acme", 1],
        ["globex", 1],
      ]),
    );
    expect(stats.sessionIds.get("sess-1")).toBe(1);
    expect(stats.sourceIds.get("gw-us")).toBe(1);
    expect(stats.fields.size).toBe(0);
  });

  it("does not count message ids", () => {
    expect(Object.keys(computeStats(all))).not.toContain("messageIds");
  });

  it("counts a derived action and the response without one under null", () => {
    expect(computeStats(all).actions.get(null)).toBe(3);
    const stats = computeStats(all, { correlator: derived });

    expect(stats.actions.get("StatusNotification")).toBe(2);
    expect(stats.actions.get(null)).toBe(2);
  });

  it("counts a multi-valued entry once per distinct value", () => {
    const twice = record(
      "d1",
      {},
      {
        deliveries: [
          { target: "a", status: "failed" },
          { target: "b", status: "failed" },
        ],
      },
    );
    const stats = computeStats([gateway.primary, gateway.queued, twice, simulator.gap]);

    expect(stats.deliveryStatuses).toEqual(
      new Map<string | null, number>([
        ["written", 1],
        ["failed", 2],
        ["queued", 1],
        [null, 1],
      ]),
    );
  });

  it("counts producer fields, a misbehaving definition as absent", () => {
    const zone: FilterFieldDefinition = {
      id: "zone",
      label: "Zone",
      values: (entry) =>
        entry.id === "s1" ? ["north", "south", "north"] : entry.id === "s2" ? ["north"] : [],
    };
    const broken: FilterFieldDefinition = {
      id: "__proto__",
      label: "Broken",
      values: (entry) => {
        if (entry.id === "s1") throw new Error("values");
        return (entry.id === "s2" ? [1, "x"] : "x") as unknown as string[];
      },
    };
    const stats = computeStats([simulator.boot, simulator.status, simulator.gap], {
      fields: [zone, broken],
    });

    expect(stats.fields.get("zone")).toEqual(
      new Map<string | null, number>([
        ["north", 2],
        ["south", 1],
        [null, 1],
      ]),
    );
    expect(stats.fields.get("__proto__")).toEqual(
      new Map<string | null, number>([
        [null, 2],
        ["x", 1],
      ]),
    );
  });

  it("rejects duplicate producer field ids", () => {
    const field: FilterFieldDefinition = { id: "a", label: "A", values: () => [] };

    expect(() => computeStats([], { fields: [field, field] })).toThrow(RangeError);
  });

  it("keeps untrusted values as plain keys", () => {
    const entries: ViewerEntry[] = ["__proto__", "constructor", "", "__proto__"].map(
      (tenant, index) => record(`u${index}`, { chargePointId: tenant }, { tenant }),
    );
    const garbage: UnparsedEntry = {
      kind: "unparsed",
      id: "x",
      raw: "",
      reason: "r",
      direction: 7 as unknown as "cp-to-csms",
    };
    const stats = computeStats([...entries, garbage]);

    expect(stats.tenants).toEqual(
      new Map<string | null, number>([
        ["__proto__", 2],
        ["constructor", 1],
        ["", 1],
        [null, 1],
      ]),
    );
    expect(stats.chargePointIds.get("__proto__")).toBe(2);
    expect(stats.directions.get(null)).toBe(1);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });
});
