import {
  createCorrelator,
  createFilterEngine,
  createViewerStore,
  type FilterEngine,
  type TraceFilter,
} from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { readSimulatorTrace } from "../src/adapter/trace-reader.ts";
import { CONNECTOR_FIELD } from "../src/fields.ts";
import { SIMULATOR_TRACE } from "./capture.ts";

async function engineFor(): Promise<FilterEngine> {
  const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
  const store = createViewerStore();
  const correlator = createCorrelator({ scope: "chargePoint" });
  correlator.connect(store);
  const engine = createFilterEngine({ correlator, fields: [CONNECTOR_FIELD] });
  engine.connect(store);
  store.load(entries);
  return engine;
}

function listed(engine: FilterEngine, filter: TraceFilter): string[] {
  engine.setFilter(filter);
  const ids: string[] = [];
  for (let index = 0; index < engine.size; index += 1) {
    const entry = engine.at(index);
    if (entry !== undefined) ids.push(entry.id);
  }
  return ids;
}

describe("filters over the captured trace", () => {
  it("splits the trace by charge point", async () => {
    const engine = await engineFor();
    expect(listed(engine, { chargePointIds: ["CP001"] })).toHaveLength(30);
    expect(listed(engine, { chargePointIds: ["CP002"] })).toHaveLength(30);
  });

  it("lists the CALLERRORs, one each way", async () => {
    const engine = await engineFor();
    expect(listed(engine, { messageTypes: ["CALLERROR"] })).toEqual(["sim-24", "sim-48"]);
    expect(listed(engine, { messageTypes: ["CALLERROR"], directions: ["cp-to-csms"] })).toEqual([
      "sim-24",
    ]);
  });

  it("lists the CSMS-initiated CALLs of CP002", async () => {
    const engine = await engineFor();
    expect(
      listed(engine, {
        chargePointIds: ["CP002"],
        directions: ["csms-to-cp"],
        messageTypes: ["CALL"],
      }),
    ).toEqual(["sim-15", "sim-23"]);
  });

  it("filters responses by the action derived from their own charge point's CALL", async () => {
    const engine = await engineFor();
    expect(listed(engine, { actions: ["GetConfiguration"] })).toEqual([
      "sim-13",
      "sim-14",
      "sim-25",
      "sim-26",
    ]);
    expect(listed(engine, { actions: ["TriggerMessage"] })).toEqual(["sim-15", "sim-16"]);
  });

  it("filters on the connector the payload names, a host field", async () => {
    const engine = await engineFor();
    const ids = listed(engine, {
      chargePointIds: ["CP002"],
      fields: [{ id: CONNECTOR_FIELD.id, values: ["1"] }],
      actions: ["StartTransaction"],
      messageTypes: ["CALL"],
    });
    expect(ids).toEqual(["sim-39"]);
    // The simulator's records carry no `connectorId`: the built-in
    // connector filter only offers "(none)".
    expect(listed(engine, { connectorIds: [null] })).toHaveLength(60);
  });
});
