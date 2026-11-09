import { describe, expect, it } from "vite-plus/test";

import { deliveryStatuses, deliveryTargets, fieldValues } from "../src/filter-extract.ts";
import { record } from "./filter-fixtures.ts";

describe("untrusted lists", () => {
  it("keeps the first occurrence of each string, in list order", () => {
    const entry = record("d", {}, {
      deliveries: [
        { target: "b", status: "written" },
        { target: "a", status: "queued" },
        { target: "b", status: "written" },
        { target: 1, status: null },
        { target: "c", status: "queued" },
      ],
    } as never);
    expect(deliveryTargets(entry)).toEqual(["b", "a", "c"]);
    expect(deliveryStatuses(entry)).toEqual(["written", "queued"]);
    const field = { id: "f", label: "F", values: () => ["y", "x", "y", "z", "x"] };
    expect(fieldValues(entry, field)).toEqual(["y", "x", "z"]);
  });

  it("deduplicates a huge list in linear time", () => {
    const deliveries = Array.from({ length: 100_000 }, (_, i) => ({
      target: `t${i}`,
      status: `s${i}`,
    }));
    const entry = record("d", {}, { deliveries } as never);
    const start = performance.now();
    expect(deliveryTargets(entry)).toHaveLength(100_000);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
