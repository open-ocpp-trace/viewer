import type { TraceRecord } from "@open-ocpp-trace/core";
import {
  createViewerStore,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { analyzeSnapshot, type Analysis } from "../src/analysis.ts";
import { entryStatus } from "../src/entry-status.ts";
import { readFixtureEntries } from "../src/load-fixture.ts";
import { buildSnapshot } from "../src/snapshot.ts";
import { readEdgeCases, readSpecFixture } from "./fixtures.ts";

async function exampleStore(): Promise<ViewerStore> {
  const store = createViewerStore();
  store.load(await readFixtureEntries("failed-auth", readSpecFixture()));
  store.load(await readFixtureEntries("edge", readEdgeCases()));
  return store;
}

function entry(store: ViewerStore, id: string): ViewerEntry {
  const found = store.get(id);
  if (found === undefined) throw new Error(`no entry ${id}`);
  return found;
}

const HEARTBEAT: TraceRecord = {
  schemaVersion: "1.1",
  timestamp: "2024-01-15T14:00:00.000Z",
  transport: "json",
  direction: "cp-to-csms",
  messageType: "CALL",
  messageId: "late-1",
  action: "Heartbeat",
  payload: {},
};

const heartbeat: ViewerEntry = { kind: "trace", id: "late", record: HEARTBEAT };

describe("entryStatus", () => {
  it("gives the event a mapped entry was parsed into", async () => {
    const store = await exampleStore();
    const analysis = analyzeSnapshot(buildSnapshot(store.toArray()));
    const eventId = analysis.mapping.eventByEntry.get("failed-auth:1");

    expect(eventId).toBeDefined();
    expect(entryStatus(analysis, entry(store, "failed-auth:1"))).toEqual({ eventId });
  });

  it("tells ignored, ambiguous and unparsed entries apart", async () => {
    const store = await exampleStore();
    const analysis = analyzeSnapshot(buildSnapshot(store.toArray()));
    const unparsed = store.toArray().find((candidate) => candidate.kind === "unparsed");

    expect(entryStatus(analysis, entry(store, "edge:1"))).toEqual({ reason: "ignored" });
    expect(entryStatus(analysis, entry(store, "edge:6"))).toEqual({ reason: "ambiguous" });
    expect(entryStatus(analysis, entry(store, "edge:7"))).toEqual({ reason: "ambiguous" });
    expect(unparsed).toBeDefined();
    expect(entryStatus(analysis, unparsed!)).toEqual({ reason: "unparsed" });
  });

  it("does not map a gap, nor anything before the first analysis", () => {
    const gap: ViewerEntry = { kind: "gap", id: "gap", reason: "disconnected" };

    expect(entryStatus(undefined, heartbeat)).toEqual({ reason: "pending" });
    expect(entryStatus(undefined, gap)).toEqual({ reason: "gap" });
  });

  it("does not map an entry missing from the analyzed snapshot", async () => {
    const store = await exampleStore();
    const analysis = analyzeSnapshot(buildSnapshot(store.toArray()));

    expect(entryStatus(analysis, heartbeat)).toEqual({ reason: "not-sent" });
  });

  it("reports a rejected record as not sent, whether or not it is older than the cut", () => {
    const rejected = (id: string, messageId: string): ViewerEntry => ({
      kind: "trace",
      id,
      record: { ...HEARTBEAT, messageId, timestamp: "not a timestamp" },
    });
    const old = rejected("old", "r-1");
    const recent = rejected("recent", "r-2");
    const kept = { ...heartbeat, id: "kept" };
    const snapshot = buildSnapshot([old, kept, recent], { maxLines: 1, maxBytes: 1_000_000 });
    // The one rule: older than the cut is truncated, newer and rejected is invalid.
    expect(snapshot.truncated).toBe(1);
    expect(snapshot.skipped.invalid).toBe(1);

    const analysis = analyzeSnapshot(snapshot);

    expect(entryStatus(analysis, old)).toEqual({ reason: "not-sent" });
    expect(entryStatus(analysis, recent)).toEqual({ reason: "not-sent" });
  });

  it("treats a re-added id as pending until the next analysis", () => {
    const analysis = analyzeSnapshot(buildSnapshot([heartbeat]));
    expect(entryStatus(analysis, heartbeat)).toHaveProperty("eventId");
    // Same id, equal content, but a new record: not the line DebugKit parsed.
    const readded: ViewerEntry = { ...heartbeat, record: { ...HEARTBEAT } };

    expect(entryStatus(analysis, readded)).toEqual({ reason: "pending" });
  });

  it("does not map an entry of a snapshot DebugKit rejected", () => {
    // DebugKit drops a record without messageId; with no record left, it rejects the snapshot.
    const { messageId: _dropped, ...withoutId } = HEARTBEAT;
    const anonymous: ViewerEntry = { kind: "trace", id: "anonymous", record: withoutId };
    const rejected = analyzeSnapshot(buildSnapshot([anonymous]));

    expect(rejected.status).toBe("error");
    expect(entryStatus(rejected, anonymous)).toEqual({ reason: "rejected" });
  });

  it("does not map anything when the mapping broke", () => {
    const snapshot = buildSnapshot([heartbeat]);
    const broken: Analysis = analyzeSnapshot(snapshot, () => ({
      events: [
        {
          id: "evt-0001",
          messageId: "other",
          timestamp: 0,
          direction: "CSMS_TO_CS",
          messageType: "CallResult",
          action: null,
          payload: {},
          errorCode: null,
          errorDescription: null,
          rawMessage: [3, "other", {}],
        },
      ],
      warnings: [],
    }));

    expect(broken.mapping.status).toBe("broken");
    expect(entryStatus(broken, heartbeat)).toEqual({ reason: "mapping-broken" });
  });
});
