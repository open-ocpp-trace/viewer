import { parseRecord } from "@open-ocpp-trace/jsonl";
import { createViewerStore, type ViewerEntry } from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { readFixtureEntries } from "../src/load-fixture.ts";
import { buildSnapshot } from "../src/snapshot.ts";
import { readEdgeCases, readSpecFixture } from "./fixtures.ts";

function trace(id: string, messageId: string, timestamp: string): ViewerEntry {
  return {
    kind: "trace",
    id,
    record: {
      schemaVersion: "1.1",
      timestamp,
      transport: "json",
      direction: "cp-to-csms",
      messageType: "CALL",
      messageId,
      action: "Heartbeat",
      payload: {},
    },
  };
}

/** The non-blank lines of `text` the SDK reader accepts, parsed. */
function conformantRecords(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => parseRecord(line).ok)
    .map((line) => JSON.parse(line) as unknown);
}

describe("readFixtureEntries", () => {
  it("turns readable lines into trace entries and the rest into unparsed entries", async () => {
    const entries = await readFixtureEntries("edge", readEdgeCases());

    expect(entries.map((entry) => [entry.id, entry.kind])).toEqual([
      ["edge:1", "trace"],
      ["edge:2", "trace"],
      ["edge:3", "trace"],
      ["edge:4", "unparsed"],
      ["edge:5", "trace"],
      ["edge:6", "trace"],
      ["edge:7", "trace"],
    ]);
    const unparsed = entries[3];
    expect(unparsed?.kind === "unparsed" && unparsed.raw).toContain('"edge-no-action"');
  });
});

describe("buildSnapshot", () => {
  it("serializes the trace entries of the store in store order, one line each", async () => {
    const store = createViewerStore();
    store.load(await readFixtureEntries("failed-auth", readSpecFixture()));
    store.load(await readFixtureEntries("edge", readEdgeCases()));

    const snapshot = buildSnapshot(store.toArray());

    const lines = snapshot.text.split("\n").filter((line) => line !== "");
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      ...conformantRecords(readSpecFixture()),
      ...conformantRecords(readEdgeCases()),
    ]);
    expect(snapshot.entryIds).toHaveLength(lines.length);
    expect(snapshot.entryIds[0]).toBe("failed-auth:1");
    expect(snapshot.entryIds.at(-1)).toBe("edge:7");
    expect(snapshot.skipped).toEqual({ unparsed: 1, gap: 0, invalid: 0 });
    expect(snapshot.truncated).toBe(0);
  });

  it("never sends gap or unparsed entries", () => {
    const snapshot = buildSnapshot([
      trace("a", "m-1", "2024-01-15T11:00:00.000Z"),
      { kind: "gap", id: "g", reason: "disconnected" },
      { kind: "unparsed", id: "u", raw: "{", reason: "bad json" },
      trace("b", "m-2", "2024-01-15T11:00:01.000Z"),
    ]);

    expect(snapshot.entryIds).toEqual(["a", "b"]);
    expect(snapshot.lines.map((line) => line.entryId)).toEqual(["a", "b"]);
    expect(snapshot.skipped).toEqual({ unparsed: 1, gap: 1, invalid: 0 });
  });

  it("keeps the newest lines when the line limit is exceeded", () => {
    const entries = [1, 2, 3, 4].map((n) =>
      trace(`e${n}`, `m-${n}`, `2024-01-15T11:00:0${n}.000Z`),
    );

    const snapshot = buildSnapshot(entries, { maxLines: 2, maxBytes: 1_000_000 });

    expect(snapshot.entryIds).toEqual(["e3", "e4"]);
    expect(snapshot.truncated).toBe(2);
    expect(snapshot.text.split("\n").filter((line) => line !== "")).toHaveLength(2);
  });

  it("keeps the newest lines that fit the byte limit", () => {
    const entries = [1, 2, 3].map((n) => trace(`e${n}`, `m-${n}`, `2024-01-15T11:00:0${n}.000Z`));
    const oneLine = buildSnapshot(entries.slice(0, 1)).text;
    const bytes = new TextEncoder().encode(oneLine).length;

    const snapshot = buildSnapshot(entries, { maxLines: 10, maxBytes: bytes * 2 });

    expect(snapshot.entryIds).toEqual(["e2", "e3"]);
    expect(snapshot.truncated).toBe(1);
  });

  it("counts a record the writer rejects as invalid, unless it is older than the cut", () => {
    const entries = [1, 2, 3, 4, 5].map((n) =>
      trace(`e${n}`, `m-${n}`, `2024-01-15T11:00:0${n}.000Z`),
    );
    // e1 is older than the cut, right behind it, e4 newer: e4 is invalid, e1 truncated.
    const rejected = (entry: ViewerEntry): ViewerEntry =>
      entry.kind === "trace"
        ? { ...entry, record: { ...entry.record, timestamp: "not a timestamp" } }
        : entry;
    const [e1, e2, e3, e4, e5] = entries;
    const mixed = [rejected(e1!), e2!, e3!, rejected(e4!), e5!];

    const snapshot = buildSnapshot(mixed, { maxLines: 3, maxBytes: 1_000_000 });

    expect(snapshot.entryIds).toEqual(["e2", "e3", "e5"]);
    expect(snapshot.skipped.invalid).toBe(1);
    expect(snapshot.truncated).toBe(1);
  });

  it("is empty for a store without trace entries", () => {
    const snapshot = buildSnapshot([{ kind: "gap", id: "g", reason: "unknown" }]);

    expect(snapshot).toMatchObject({ text: "", entryIds: [], truncated: 0 });
  });
});
