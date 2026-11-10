import { createViewerStore } from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { analyzeSnapshot } from "../src/analysis.ts";
import { readFixtureEntries } from "../src/load-fixture.ts";
import { buildSnapshot } from "../src/snapshot.ts";
import { readEdgeCases, readSpecFixture } from "./fixtures.ts";

async function exampleSnapshot(): Promise<ReturnType<typeof buildSnapshot>> {
  const store = createViewerStore();
  store.load(await readFixtureEntries("failed-auth", readSpecFixture()));
  store.load(await readFixtureEntries("edge", readEdgeCases()));
  return buildSnapshot(store.toArray());
}

describe("analyzeSnapshot", () => {
  it("parses, maps and detects failures, keeping DebugKit's warnings verbatim", async () => {
    const snapshot = await exampleSnapshot();

    const analysis = analyzeSnapshot(snapshot);

    expect(analysis.status).toBe("ok");
    expect(analysis.events).toHaveLength(snapshot.lines.length - 2);
    expect(analysis.warnings.map((warning) => warning.message)).toEqual([
      "Record 15: has no messageId and cannot be mapped to an event.",
      "Record 16: raw frame disagrees with the record's messageId; using raw.",
      "Record 17: raw is not valid JSON; using decomposed fields.",
      "Record 19: CALLERROR record has no error.code.",
    ]);
    expect(analysis.failures.map((failure) => failure.code)).toContain("FAILED_AUTHORIZATION");
    expect(analysis.mapping.unmappedEntryIds).toEqual(["edge:1", "edge:6", "edge:7"]);
  });

  it("reports a ParseError instead of throwing, with every entry unmapped", () => {
    const snapshot = buildSnapshot([
      {
        kind: "trace",
        id: "only",
        record: {
          schemaVersion: "1.1",
          timestamp: "2024-01-15T11:00:00.000Z",
          transport: "json",
          direction: "cp-to-csms",
          messageType: "CALL",
          action: "Heartbeat",
          payload: {},
        },
      },
    ]);

    const analysis = analyzeSnapshot(snapshot);

    expect(analysis.status).toBe("error");
    expect(analysis.error).toBe("Trace contains no valid Open OCPP Trace records.");
    expect(analysis.events).toEqual([]);
    expect(analysis.warnings).toEqual([]);
    expect(analysis.mapping.unmappedEntryIds).toEqual(["only"]);
  });

  it("does not call DebugKit for an empty snapshot", () => {
    let calls = 0;

    const analysis = analyzeSnapshot(buildSnapshot([]), () => {
      calls += 1;
      return { events: [], warnings: [] };
    });

    expect(calls).toBe(0);
    expect(analysis.status).toBe("empty");
  });

  it("lets an unexpected error propagate", () => {
    const snapshot = buildSnapshot([{ kind: "unparsed", id: "u", raw: "{", reason: "bad" }]);
    expect(analyzeSnapshot(snapshot).status).toBe("empty");

    const nonEmpty = { ...snapshot, text: "x\n" };
    expect(() =>
      analyzeSnapshot(nonEmpty, () => {
        throw new TypeError("bug");
      }),
    ).toThrow(TypeError);
  });
});
