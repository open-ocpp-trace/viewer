import { describe, expect, it } from "vite-plus/test";

import type { ViewerEntry } from "../src/entry.ts";
import {
  connectorValue,
  deliveryStatuses,
  deliveryTargets,
  fieldValues,
  type MatchContext,
  stringValue,
  timeValue,
} from "../src/filter-extract.ts";
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

describe("record-like property on a non-trace entry", () => {
  const recordLike = {
    chargePointId: "CP-REC",
    action: "Heartbeat",
    direction: "csms-to-cp",
    ocppVersion: "ocpp1.6",
    messageType: "CALL",
    messageId: "m-rec",
    connectorId: 1,
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  const metadata = {
    chargePointId: "CP-META",
    sessionId: "S",
    tenant: "T",
    source: { id: "SRC" },
  };
  const unparsed = {
    kind: "unparsed",
    id: "u",
    raw: "x",
    reason: "bad",
    direction: "cp-to-csms",
    timestamp: "2026-11-09T10:00:07.000Z",
    record: recordLike,
    metadata,
  } as unknown as ViewerEntry;
  const gap = {
    kind: "gap",
    id: "g",
    reason: "dropped",
    record: recordLike,
    metadata,
  } as unknown as ViewerEntry;
  const ctx: MatchContext = {
    fields: new Map(),
    correlator: { get: () => ({ action: "Derived" }) as never },
  };

  it("ignores the record and reads the entry and its metadata only", () => {
    const values = (entry: ViewerEntry) =>
      Object.fromEntries(
        (
          [
            "chargePointIds",
            "actions",
            "directions",
            "ocppVersions",
            "messageTypes",
            "messageIds",
            "sessionIds",
            "tenants",
            "sourceIds",
          ] as const
        ).map((property) => [property, stringValue(entry, property, ctx)]),
      );
    const fromMetadata = { sessionIds: "S", tenants: "T", sourceIds: "SRC" };
    expect(values(unparsed)).toEqual({
      chargePointIds: "CP-META",
      actions: null,
      directions: "cp-to-csms",
      ocppVersions: null,
      messageTypes: null,
      messageIds: null,
      ...fromMetadata,
    });
    expect(values(gap)).toEqual({
      chargePointIds: "CP-META",
      actions: null,
      directions: null,
      ocppVersions: null,
      messageTypes: null,
      messageIds: null,
      ...fromMetadata,
    });
    expect(connectorValue(unparsed)).toBeNull();
    expect(timeValue(unparsed)).toBe(Date.parse("2026-11-09T10:00:07.000Z"));
    expect(timeValue(gap)).toBeUndefined();
  });
});
