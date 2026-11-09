import type { TraceRecord } from "@open-ocpp-trace/core";
import { describe, expect, expectTypeOf, it } from "vite-plus/test";

import type {
  EntryMetadata,
  EntryUpdate,
  GapEntry,
  TraceEntry,
  UnparsedEntry,
  ViewerEntry,
  ViewerSelection,
} from "@open-ocpp-trace/viewer-core";

import { createGatewayAdapter } from "./sketches/gateway-adapter.ts";
import { createSimulatorAdapter, simulatorTraceEntry } from "./sketches/simulator-adapter.ts";

const record: TraceRecord = {
  schemaVersion: "1.1",
  timestamp: "2026-11-09T10:00:00.000Z",
  transport: "json",
  direction: "cp-to-csms",
  chargePointId: "CP-1",
  messageType: "CALL",
  messageId: "42",
  action: "Heartbeat",
  payload: {},
  raw: '[2,"42","Heartbeat",{}]',
};

describe("entry kinds", () => {
  it("keeps unparsed frames and gaps apart from conformant records", () => {
    expectTypeOf<UnparsedEntry>().not.toExtend<TraceRecord>();
    expectTypeOf<GapEntry>().not.toExtend<TraceRecord>();
    expectTypeOf<ViewerEntry>().not.toExtend<TraceRecord>();
  });

  it("narrows on kind", () => {
    const describeEntry = (entry: ViewerEntry): string => {
      switch (entry.kind) {
        case "trace":
          expectTypeOf(entry).toEqualTypeOf<TraceEntry>();
          return entry.record.messageType;
        case "unparsed":
          expectTypeOf(entry).toEqualTypeOf<UnparsedEntry>();
          return entry.reason;
        case "gap":
          expectTypeOf(entry).toEqualTypeOf<GapEntry>();
          return entry.reason;
      }
    };
    expect(describeEntry({ kind: "gap", id: "g", reason: "dropped" })).toBe("dropped");
  });

  it("keeps the record readonly", () => {
    // Type-level only: never called, so the shared record stays intact.
    const writeThrough = (entry: TraceEntry): void => {
      // @ts-expect-error the record is source-owned
      entry.record = record;
      // @ts-expect-error its fields cannot be written through the entry
      entry.record.timestamp = "2026-11-09T11:00:00.000Z";
      // @ts-expect-error nor can the entry identity
      entry.id = "2";
    };
    expectTypeOf(writeThrough).toBeFunction();
  });

  it("wraps one record with or without producer context", () => {
    const bare: TraceEntry = { kind: "trace", id: "1", record };
    const withContext: TraceEntry = {
      kind: "trace",
      id: "2",
      record,
      metadata: { chargePointId: "CP-from-gateway", source: { id: "gateway" } },
    };
    expect(bare.record).toBe(withContext.record);

    // The record wins; metadata only supplies what the record lacks.
    const chargePointOf = (entry: TraceEntry): string | undefined =>
      entry.record.chargePointId ?? entry.metadata?.chargePointId;
    expect(chargePointOf(withContext)).toBe("CP-1");
  });
});

describe("entry updates", () => {
  it("can only touch metadata", () => {
    const update: EntryUpdate = {
      type: "update",
      id: "1",
      revision: 2,
      metadata: { deliveries: [{ target: "csms-a", status: "written" }] },
    };
    expect(update.type).toBe("update");

    const withRecord: EntryUpdate = {
      type: "update",
      id: "1",
      metadata: {},
      // @ts-expect-error an update never carries the record
      record,
    };
    const withNestedRecord: EntryUpdate = {
      type: "update",
      id: "1",
      // @ts-expect-error not even inside the metadata patch
      metadata: { record },
    };
    expect([withRecord, withNestedRecord]).toHaveLength(2);
  });

  it("accepts statuses and gap reasons beyond the known vocabulary", () => {
    const metadata: EntryMetadata = {
      deliveries: [{ target: "t", status: "acknowledged" }],
      custom: { anything: 1 },
    };
    const gap: GapEntry = { kind: "gap", id: "g", reason: "buffer-full" };
    expect([metadata, gap]).toHaveLength(2);
  });

  it("selects one entry or none", () => {
    expectTypeOf<ViewerSelection["entryId"]>().toEqualTypeOf<string | null>();
  });
});

describe("adapter sketches", () => {
  const frozen = Object.freeze({ ...record }) as TraceRecord;

  it("passes the simulator's record through untouched", async () => {
    const { adapter, push } = createSimulatorAdapter([{ line: lineOf(frozen), record: frozen }], {
      sessionId: "s-1",
    });
    const updates: EntryUpdate[] = [];
    adapter.subscribe((batch) => updates.push(...batch));
    push({ line: lineOf(frozen), record: frozen });
    push({
      line: { timestamp: frozen.timestamp, message: "Sent: [5]", cpId: "CP-1" },
      record: null,
      reason: "unknown-message-type",
      direction: "cp-to-csms",
    });

    const [fromSnapshot] = await adapter.snapshot();
    expect(fromSnapshot?.kind === "trace" && fromSnapshot.record).toBe(frozen);
    const [added, unparsed] = updates;
    expect(added?.type === "add" && added.entry.kind === "trace" && added.entry.record).toBe(
      frozen,
    );
    expect(unparsed?.type === "add" && unparsed.entry.kind).toBe("unparsed");
    expect(simulatorTraceEntry("bare", frozen)).toEqual({ kind: "trace", id: "bare", record });
  });

  it("expresses gateway deliveries beside the record, then a gap", async () => {
    const gateway = createGatewayAdapter();
    const updates: EntryUpdate[] = [];
    // The viewer subscribes first, buffering batches, then takes the snapshot.
    const unsubscribe = gateway.adapter.subscribe((batch) => updates.push(...batch));
    expect(await gateway.adapter.snapshot()).toEqual([]);
    const queued = {
      target: "csms-a",
      role: "primary",
      status: "queued",
      updatedAt: frozen.timestamp,
    } as const;
    gateway.receive({
      kind: "trace",
      id: "t-1",
      tenantId: null,
      sessionId: "s-1",
      chargePointId: "CP-1",
      receivedAt: frozen.timestamp,
      deliveries: [queued],
      trace: frozen,
    });
    gateway.deliveryChanged({ id: "t-1", delivery: { ...queued, status: "written" } });
    gateway.reconnected("2026-11-09T10:05:00.000Z", 3);
    unsubscribe();
    gateway.reconnected("2026-11-09T10:06:00.000Z");

    expect(updates).toHaveLength(3);
    const [added, changed, gap] = updates;
    expect(added?.type === "add" && added.entry.kind === "trace" && added.entry.record).toBe(
      frozen,
    );
    expect(changed).toEqual({
      type: "update",
      id: "t-1",
      metadata: { deliveries: [{ ...queued, status: "written" }] },
    });
    expect(gap?.type === "add" && gap.entry).toMatchObject({
      kind: "gap",
      reason: "disconnected",
      missedCount: 3,
    });
  });
});

function lineOf(trace: TraceRecord): { timestamp: string; message: string } {
  return { timestamp: trace.timestamp, message: `Sent: ${trace.raw ?? ""}` };
}
