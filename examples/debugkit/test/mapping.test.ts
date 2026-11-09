import { ParseError, parseOpenOcppTrace, type Event } from "@ocpp-debugkit/toolkit/core";
import type { TraceRecord } from "@open-ocpp-trace/core";
import { createViewerStore, type TraceEntry } from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { readFixtureEntries } from "../src/load-fixture.ts";
import { mapEvents } from "../src/mapping.ts";
import { buildSnapshot, type AnalysisSnapshot } from "../src/snapshot.ts";
import { readEdgeCases, readSpecFixture } from "./fixtures.ts";

function call(
  messageId: string | undefined,
  second: number,
  extra: Partial<TraceRecord> = {},
): TraceRecord {
  return {
    schemaVersion: "1.1",
    timestamp: `2024-01-15T11:00:${String(second).padStart(2, "0")}.000Z`,
    transport: "json",
    direction: "cp-to-csms",
    messageType: "CALL",
    ...(messageId === undefined ? {} : { messageId }),
    action: "Heartbeat",
    payload: {},
    ...extra,
  } as TraceRecord;
}

function snapshotOf(records: readonly TraceRecord[]): AnalysisSnapshot {
  return buildSnapshot(
    records.map((record, index): TraceEntry => ({ kind: "trace", id: `line-${index}`, record })),
  );
}

/** A DebugKit event with the keys of `record`, as a hand-built parse result would hold. */
function eventFor(id: string, record: TraceRecord): Event {
  return {
    id,
    messageId: record.messageId ?? "",
    timestamp: Date.parse(record.timestamp),
    direction: record.direction === "cp-to-csms" ? "CS_TO_CSMS" : "CSMS_TO_CS",
    messageType: "Call",
    action: record.action ?? null,
    payload: record.payload,
    errorCode: null,
    errorDescription: null,
    rawMessage: [2, record.messageId ?? "", record.action, record.payload],
  };
}

describe("mapEvents", () => {
  it("maps a clean trace one to one", () => {
    const snapshot = snapshotOf([call("m-1", 1), call("m-2", 2), call("m-2", 2)]);
    const { events } = parseOpenOcppTrace(snapshot.text);

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.status).toBe("aligned");
    expect([...mapping.eventByEntry]).toEqual([
      ["line-0", events[0]?.id],
      ["line-1", events[1]?.id],
      ["line-2", events[2]?.id],
    ]);
    expect([...mapping.entryByEvent]).toEqual([
      [events[0]?.id, "line-0"],
      [events[1]?.id, "line-1"],
      [events[2]?.id, "line-2"],
    ]);
    expect(mapping.unmappedEntryIds).toEqual([]);
    expect(mapping.unmatchedEventIds).toEqual([]);
  });

  it("maps later records right after a record DebugKit dropped", () => {
    const snapshot = snapshotOf([
      call("m-1", 1),
      call(undefined, 2),
      call("m-3", 3),
      call("m-4", 4),
    ]);
    const { events } = parseOpenOcppTrace(snapshot.text);
    expect(events).toHaveLength(3);

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.status).toBe("aligned");
    expect(events.map((event) => [event.messageId, mapping.entryByEvent.get(event.id)])).toEqual([
      ["m-1", "line-0"],
      ["m-3", "line-2"],
      ["m-4", "line-3"],
    ]);
    expect(mapping.unmappedEntryIds).toEqual(["line-1"]);
    expect(mapping.ambiguousEntryIds).toEqual([]);
  });

  it("matches on the raw frame's messageId when raw and fields disagree", () => {
    const snapshot = snapshotOf([
      call("m-fields", 1, { raw: '[2,"m-raw","Heartbeat",{}]' }),
      call("m-2", 2, { raw: "not a frame" }),
    ]);
    const { events, warnings } = parseOpenOcppTrace(snapshot.text);
    expect(events.map((event) => event.messageId)).toEqual(["m-raw", "m-2"]);
    expect(warnings).toHaveLength(2);

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.status).toBe("aligned");
    expect(mapping.eventByEntry.get("line-0")).toBe(events[0]?.id);
    expect(mapping.eventByEntry.get("line-1")).toBe(events[1]?.id);
  });

  it("leaves indistinguishable neighbours unmapped when DebugKit dropped one of them", () => {
    const answer = (code: string | undefined): TraceRecord => ({
      schemaVersion: "1.1",
      timestamp: "2024-01-15T11:00:05.300Z",
      transport: "json",
      direction: "csms-to-cp",
      messageType: "CALLERROR",
      messageId: "dt-1",
      error: code === undefined ? { description: "no code" } : { code, description: "unsupported" },
    });
    const snapshot = snapshotOf([
      call("dt-1", 5),
      answer(undefined),
      answer("NotImplemented"),
      call("m-9", 9),
    ]);
    const { events } = parseOpenOcppTrace(snapshot.text);
    expect(events).toHaveLength(3);

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.status).toBe("aligned");
    expect(mapping.eventByEntry.get("line-0")).toBe(events[0]?.id);
    expect(mapping.eventByEntry.get("line-3")).toBe(events[2]?.id);
    expect(mapping.eventByEntry.has("line-1")).toBe(false);
    expect(mapping.eventByEntry.has("line-2")).toBe(false);
    expect(mapping.unmappedEntryIds).toEqual(["line-1", "line-2"]);
    expect(mapping.ambiguousEntryIds).toEqual(["line-1", "line-2"]);
    expect(mapping.unmatchedEventIds).toEqual([events[1]?.id]);
  });

  it("treats a record without messageId as dropped even when its raw frame has one", () => {
    const snapshot = snapshotOf([
      call(undefined, 1, { raw: '[2,"m-1","Heartbeat",{}]' }),
      call("m-1", 1),
    ]);
    const { events } = parseOpenOcppTrace(snapshot.text);
    expect(events).toHaveLength(1);

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.eventByEntry.get("line-1")).toBe(events[0]?.id);
    expect(mapping.unmappedEntryIds).toEqual(["line-0"]);
    expect(mapping.ambiguousEntryIds).toEqual([]);
  });

  it("does not correlate duplicate messageIds that differ on another key", () => {
    const records = [call("dup", 1), call("dup", 2), call("dup", 3)];
    const snapshot = snapshotOf(records);
    // DebugKit kept the first and the last: hand-built to pin the alignment.
    const events = [eventFor("evt-0001", records[0]!), eventFor("evt-0002", records[2]!)];

    const mapping = mapEvents(snapshot.lines, events);

    expect([...mapping.entryByEvent]).toEqual([
      ["evt-0001", "line-0"],
      ["evt-0002", "line-2"],
    ]);
    expect(mapping.unmappedEntryIds).toEqual(["line-1"]);
  });

  it("leaves every candidate unmapped when one event fits several identical lines", () => {
    const records = [call("dup", 1), call("dup", 1), call("dup", 1)];
    const snapshot = snapshotOf(records);
    const events = [eventFor("evt-0001", records[0]!)];

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.status).toBe("aligned");
    expect(mapping.entryByEvent.size).toBe(0);
    expect(mapping.unmappedEntryIds).toEqual(["line-0", "line-1", "line-2"]);
    expect(mapping.ambiguousEntryIds).toEqual(["line-0", "line-1", "line-2"]);
    expect(mapping.unmatchedEventIds).toEqual(["evt-0001"]);
  });

  it("drops the whole mapping when an event matches no line", () => {
    const records = [call("m-1", 1), call("m-2", 2)];
    const snapshot = snapshotOf(records);
    const events = [eventFor("evt-0001", records[0]!), eventFor("evt-0002", call("elsewhere", 7))];

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.status).toBe("broken");
    expect(mapping.reason).toContain("evt-0002");
    expect(mapping.entryByEvent.size).toBe(0);
    expect(mapping.eventByEntry.size).toBe(0);
    expect(mapping.unmappedEntryIds).toEqual(["line-0", "line-1"]);
    expect(mapping.unmatchedEventIds).toEqual(["evt-0001", "evt-0002"]);
  });

  it("maps nothing for an empty result", () => {
    const snapshot = snapshotOf([call("m-1", 1)]);

    const mapping = mapEvents(snapshot.lines, []);

    expect(mapping.status).toBe("aligned");
    expect(mapping.entryByEvent.size).toBe(0);
    expect(mapping.unmappedEntryIds).toEqual(["line-0"]);
  });

  it("is never reached with events when DebugKit rejects the whole snapshot", () => {
    const snapshot = snapshotOf([call(undefined, 1)]);

    expect(() => parseOpenOcppTrace(snapshot.text)).toThrow(ParseError);
    expect(mapEvents(snapshot.lines, []).unmappedEntryIds).toEqual(["line-0"]);
  });

  it("maps the example's trace, ignoring what DebugKit dropped and what is ambiguous", async () => {
    const store = createViewerStore();
    store.load(await readFixtureEntries("failed-auth", readSpecFixture()));
    store.load(await readFixtureEntries("edge", readEdgeCases()));
    const snapshot = buildSnapshot(store.toArray());
    const { events } = parseOpenOcppTrace(snapshot.text);

    const mapping = mapEvents(snapshot.lines, events);

    expect(mapping.status).toBe("aligned");
    expect(mapping.unmappedEntryIds).toEqual(["edge:1", "edge:6", "edge:7"]);
    expect(mapping.ambiguousEntryIds).toEqual(["edge:6", "edge:7"]);
    expect(mapping.unmatchedEventIds).toHaveLength(1);
    expect(mapping.entryByEvent.size).toBe(events.length - 1);
    for (const [eventId, entryId] of mapping.entryByEvent) {
      const event = events.find((candidate) => candidate.id === eventId);
      const entry = store.get(entryId);
      expect(entry?.kind === "trace" && entry.record.timestamp).toBe(
        event === undefined ? undefined : new Date(event.timestamp ?? 0).toISOString(),
      );
    }
  });
});
