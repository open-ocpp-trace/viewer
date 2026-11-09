import { describe, expect, it } from "vite-plus/test";

import type { TraceFilter } from "@open-ocpp-trace/viewer-core";

import { sameFilter } from "../src/same-filter.ts";

describe("sameFilter", () => {
  it("compares plain data structurally, whatever the key order", () => {
    expect(
      sameFilter(
        { chargePointIds: ["CP-1", null], timeRange: { from: "2026-11-09T10:00:00Z" }, text: "x" },
        { text: "x", timeRange: { from: "2026-11-09T10:00:00Z" }, chargePointIds: ["CP-1", null] },
      ),
    ).toBe(true);
    expect(
      sameFilter(
        { fields: [{ id: "f", values: ["a"] }] },
        { fields: [{ values: ["a"], id: "f" }] },
      ),
    ).toBe(true);
  });

  it("ignores undefined properties at every level", () => {
    // A JavaScript host may leave undefined properties behind.
    const sparse = (filter: object): TraceFilter => filter as TraceFilter;
    expect(sameFilter(sparse({ text: undefined }), {})).toBe(true);
    expect(
      sameFilter(sparse({ timeRange: { from: "2026", to: undefined } }), {
        timeRange: { from: "2026" },
      }),
    ).toBe(true);
  });

  it("tells an empty list, which matches nothing, from an absent one", () => {
    expect(sameFilter({ actions: [] }, {})).toBe(false);
    expect(sameFilter({}, { actions: [] })).toBe(false);
  });

  it("keeps null, strings and numbers apart", () => {
    expect(sameFilter({ chargePointIds: [null] }, { chargePointIds: ["null"] })).toBe(false);
    expect(
      sameFilter({ connectorIds: [1] }, { connectorIds: ["1"] } as unknown as TraceFilter),
    ).toBe(false);
    expect(sameFilter({ searchPayloads: false }, {})).toBe(false);
  });

  it("treats a reordered list as different", () => {
    expect(sameFilter({ actions: ["A", "B"] }, { actions: ["B", "A"] })).toBe(false);
  });

  it("never throws on malformed shapes", () => {
    const malformed = [
      null,
      5,
      "x",
      { fields: "x" },
      { timeRange: 5 },
      [1],
    ] as unknown as TraceFilter[];
    for (const a of malformed) {
      for (const b of malformed) expect(() => sameFilter(a, b)).not.toThrow();
    }
    expect(
      sameFilter(
        { fields: "x" } as unknown as TraceFilter,
        { fields: ["x"] } as unknown as TraceFilter,
      ),
    ).toBe(false);
  });
});
