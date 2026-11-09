import { describe, expect, it } from "vite-plus/test";

import {
  type Correlator,
  createCorrelator,
  createViewerStore,
  type EntryFields,
  readEntryFields,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { record, simulator } from "./filter-fixtures.ts";

const absent: EntryFields = {
  timestamp: null,
  chargePointId: null,
  connectorId: null,
  direction: null,
  messageType: null,
  action: null,
  messageId: null,
};

describe("readEntryFields", () => {
  it("reads the display values of a trace entry", () => {
    expect(readEntryFields(simulator.status)).toEqual({
      timestamp: "2026-11-09T10:00:05.000Z",
      chargePointId: "CP-1",
      connectorId: 1,
      direction: "cp-to-csms",
      messageType: "CALL",
      action: "StatusNotification",
      messageId: "m-s2",
    });
  });

  it("takes the charge point from the metadata when the record lacks it", () => {
    const entry = record("t", {}, { chargePointId: "CP-META" });
    expect(readEntryFields(entry).chargePointId).toBe("CP-META");
    const both = record("u", { chargePointId: "CP-REC" }, { chargePointId: "CP-META" });
    expect(readEntryFields(both).chargePointId).toBe("CP-REC");
  });

  it("derives the action of a response from the correlator", () => {
    const store = createViewerStore();
    const correlator = createCorrelator();
    correlator.connect(store);
    store.load([simulator.status, simulator.result]);
    expect(readEntryFields(simulator.result).action).toBeNull();
    expect(readEntryFields(simulator.result, correlator).action).toBe("StatusNotification");
  });

  it("ignores a correlator that throws", () => {
    const correlator = {
      get: () => {
        throw new Error("boom");
      },
    } as unknown as Correlator;
    expect(readEntryFields(simulator.result, correlator).action).toBeNull();
  });

  it("reads an unparsed entry's own timestamp and direction", () => {
    const entry: ViewerEntry = { ...simulator.garbage, metadata: { chargePointId: "CP-9" } };
    expect(readEntryFields(entry)).toEqual({
      ...absent,
      timestamp: "2026-11-09T10:00:07.000Z",
      chargePointId: "CP-9",
      direction: "cp-to-csms",
    });
  });

  it("reads a gap's timestamp only", () => {
    const entry: ViewerEntry = { kind: "gap", id: "g", reason: "dropped", timestamp: "T" };
    expect(readEntryFields(entry)).toEqual({ ...absent, timestamp: "T" });
    expect(readEntryFields(simulator.gap)).toEqual(absent);
  });

  it("treats values of the wrong runtime type as absent", () => {
    const entry = record("w", {
      timestamp: 42,
      chargePointId: { id: "CP" },
      connectorId: "1",
      direction: true,
      messageType: 2,
      action: ["Heartbeat"],
      messageId: null,
    });
    expect(readEntryFields(entry)).toEqual(absent);
    expect(readEntryFields(record("n", { connectorId: -1 })).connectorId).toBeNull();
    expect(readEntryFields(record("f", { connectorId: 1.5 })).connectorId).toBeNull();
  });

  it("never throws on hostile entries", () => {
    const hostile = {
      kind: "trace",
      id: "h",
      get record(): never {
        throw new Error("boom");
      },
      get metadata(): never {
        throw new Error("boom");
      },
    } as unknown as ViewerEntry;
    expect(readEntryFields(hostile)).toEqual(absent);
    const unparsed = { kind: "unparsed", id: "u", raw: 1, reason: 2, timestamp: 3 };
    expect(readEntryFields(unparsed as unknown as ViewerEntry)).toEqual(absent);
  });
});
