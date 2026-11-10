import type { TraceRecord } from "@open-ocpp-trace/core";
import {
  createCorrelator,
  createFilterEngine,
  createViewerStore,
  type TraceEntry,
} from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { readSimulatorTrace, SIMULATOR_SOURCE } from "../src/adapter/trace-reader.ts";
import { parsedRecords, SIMULATOR_TRACE } from "./capture.ts";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Counts by "<cp> <direction> <messageType>". */
function countBy(records: readonly TraceRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const key = `${record.chargePointId} ${record.direction} ${record.messageType}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

describe("readSimulatorTrace on the captured TraceWriter output", () => {
  it("maps each of the 60 records to a trace entry with a line-based id", async () => {
    const { entries, issues } = await readSimulatorTrace(SIMULATOR_TRACE);

    expect(issues).toEqual([]);
    expect(entries).toHaveLength(60);
    expect(entries.map((entry) => entry.id)).toEqual(
      Array.from({ length: 60 }, (_, index) => `sim-${index + 1}`),
    );
    expect(entries.every((entry) => entry.kind === "trace")).toBe(true);
  });

  it("gives the same ids on every read", async () => {
    const first = await readSimulatorTrace(SIMULATOR_TRACE);
    const second = await readSimulatorTrace(SIMULATOR_TRACE);
    expect(second.entries.map((entry) => entry.id)).toEqual(first.entries.map((entry) => entry.id));
  });

  it("keeps each record exactly as the simulator wrote it", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    const expected = parsedRecords();
    entries.forEach((entry, index) => {
      expect(entry.record).toStrictEqual(expected[index]);
    });
  });

  it("adds only the charge point and the simulator source as metadata", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    const [first] = entries;
    expect(first?.metadata).toEqual({
      chargePointId: "CP001",
      source: { id: "simulator", label: "OCPP CP Simulator" },
    });
    expect(SIMULATOR_SOURCE).toEqual({ id: "simulator", label: "OCPP CP Simulator" });
  });

  it("matches the per charge point counts of the capture's HOW.md", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    expect(countBy(entries.map((entry) => entry.record))).toEqual({
      "CP001 cp-to-csms CALL": 13,
      "CP001 csms-to-cp CALLRESULT": 12,
      "CP001 csms-to-cp CALLERROR": 1,
      "CP001 csms-to-cp CALL": 2,
      "CP001 cp-to-csms CALLRESULT": 2,
      "CP002 cp-to-csms CALL": 13,
      "CP002 csms-to-cp CALLRESULT": 13,
      "CP002 csms-to-cp CALL": 2,
      "CP002 cp-to-csms CALLRESULT": 1,
      "CP002 cp-to-csms CALLERROR": 1,
    });
  });

  it("finds the one record carrying meta.validation", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    const validated = entries.filter((entry) => entry.record.meta?.["validation"] !== undefined);
    expect(validated.map((entry) => entry.id)).toEqual(["sim-25"]);
    expect(validated[0]?.record.meta?.["validation"]).toEqual({
      mode: "warn",
      errorCode: "TypeConstraintViolation",
      description: "Invalid GetConfiguration payload: /key must be array",
    });
  });

  it("reports an unreadable line as an issue, never as a fabricated entry", async () => {
    const text = `${SIMULATOR_TRACE}not json\n{"schemaVersion":"1.1"}\n`;
    const { entries, issues } = await readSimulatorTrace(text);

    expect(entries).toHaveLength(60);
    expect(issues.map(({ line, kind }) => ({ line, kind }))).toEqual([
      { line: 61, kind: "json" },
      { line: 62, kind: "validation" },
    ]);
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
  });

  it("is never mutated by the store, the correlator or the filter engine", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    for (const entry of entries) deepFreeze(entry);

    const store = createViewerStore();
    const correlator = createCorrelator({ scope: "chargePoint" });
    correlator.connect(store);
    const engine = createFilterEngine({ correlator });
    engine.connect(store);
    store.load(entries);
    engine.setFilter({ actions: ["GetConfiguration"] });

    const expected = parsedRecords();
    entries.forEach((entry, index) => {
      expect(entry.record).toStrictEqual(expected[index]);
      expect((store.get(entry.id) as TraceEntry).record).toBe(entry.record);
    });
  });
});
