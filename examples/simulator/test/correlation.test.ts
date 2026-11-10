import {
  createCorrelator,
  createViewerStore,
  type CorrelationScope,
  type EntryCorrelation,
  type TraceEntry,
} from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { readSimulatorTrace } from "../src/adapter/trace-reader.ts";
import { csmsFrames, SIMULATOR_TRACE } from "./capture.ts";

// The capture holds two real cross charge point collisions, both from the
// CSMS: `csms-0001` is GetConfiguration on CP001 (sim-13, answered by
// sim-14) and TriggerMessage on CP002 (sim-15, answered by sim-16);
// `csms-0002` is FooBar on CP002 (sim-23, CALLERROR sim-24) and a
// GetConfiguration on CP001 (sim-25, answered by sim-26).
const PAIRS = { "sim-14": "sim-13", "sim-16": "sim-15", "sim-24": "sim-23", "sim-26": "sim-25" };

function correlate(entries: readonly TraceEntry[], scope: CorrelationScope) {
  const store = createViewerStore();
  const correlator = createCorrelator({ scope });
  correlator.connect(store);
  store.load(entries);
  return (id: string): EntryCorrelation | undefined => correlator.get(id);
}

function callIds(get: (id: string) => EntryCorrelation | undefined): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const responseId of Object.keys(PAIRS)) {
    const correlation = get(responseId);
    pairs[responseId] = correlation?.role === "response" ? correlation.callId : "none";
  }
  return pairs;
}

/**
 * The records as the simulator wrote them, in the order the CSMS observed
 * the frames (fixtures/csms-frames.jsonl): the CSMS sent both colliding
 * CALLs before either answer came back. Each frame is joined to exactly one
 * record by charge point, direction and parsed frame; timestamps are then
 * not monotonic, which is fine since the correlator follows list order.
 */
function inCsmsOrder(entries: readonly TraceEntry[]): TraceEntry[] {
  const unused = new Set(entries);
  return csmsFrames().map((frame) => {
    const direction = frame.dir === "out" ? "csms-to-cp" : "cp-to-csms";
    const matches = [...unused].filter(
      ({ record }) =>
        record.chargePointId === frame.cp &&
        record.direction === direction &&
        JSON.stringify(JSON.parse(record.raw ?? "null")) === JSON.stringify(frame.frame),
    );
    expect(matches).toHaveLength(1);
    const [match] = matches as [TraceEntry];
    unused.delete(match);
    return match;
  });
}

describe("correlation of the colliding CSMS message ids", () => {
  it("joins every CSMS frame to exactly one record", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    const reordered = inCsmsOrder(entries);
    expect(reordered).toHaveLength(60);
    expect(new Set(reordered).size).toBe(60);
    // Both colliding CALLs precede both answers in the CSMS's view.
    const ids = reordered.map((entry) => entry.id);
    expect(ids.indexOf("sim-15")).toBeLessThan(ids.indexOf("sim-14"));
    expect(ids.indexOf("sim-25")).toBeLessThan(ids.indexOf("sim-24"));
  });

  it.each(["chargePoint", "conversation"] as const)(
    "pairs each response with its own charge point's CALL with scope %s, in both orders",
    async (scope) => {
      const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
      expect(callIds(correlate(entries, scope))).toEqual(PAIRS);
      expect(callIds(correlate(inCsmsOrder(entries), scope))).toEqual(PAIRS);
    },
  );

  it("derives the CALL's action for each response with scope chargePoint", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    const get = correlate(inCsmsOrder(entries), "chargePoint");
    expect(get("sim-14")).toMatchObject({ action: "GetConfiguration", candidates: [] });
    expect(get("sim-16")).toMatchObject({ action: "TriggerMessage", candidates: [] });
    expect(get("sim-24")).toMatchObject({ action: "FooBar", candidates: [] });
    expect(get("sim-26")).toMatchObject({ action: "GetConfiguration", candidates: [] });
  });

  it("pairs correctly with scope global in the simulator's own order", async () => {
    // Each charge point answers before the CSMS's next CALL with that id
    // reaches the simulator, so one bucket is enough there.
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    expect(callIds(correlate(entries, "global"))).toEqual(PAIRS);
  });

  it("pairs a response with the other charge point's CALL with scope global in the CSMS order", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    const get = correlate(inCsmsOrder(entries), "global");

    // The newest unanswered `csms-0001` CALL is CP002's TriggerMessage.
    expect(get("sim-14")).toMatchObject({
      callId: "sim-15",
      action: "TriggerMessage",
      candidates: ["sim-13"],
    });
    expect(get("sim-16")).toMatchObject({ callId: "sim-13", action: "GetConfiguration" });
    expect(get("sim-24")).toMatchObject({
      callId: "sim-25",
      action: "GetConfiguration",
      candidates: ["sim-23"],
    });
    expect(get("sim-26")).toMatchObject({ callId: "sim-23", action: "FooBar" });
  });
});
