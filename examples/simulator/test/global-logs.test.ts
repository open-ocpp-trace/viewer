import type { TraceRecord } from "@open-ocpp-trace/core";
import { createViewerStore, type ViewerStore } from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import {
  createGlobalLogsFeed,
  type GlobalLogEntry,
  type LogLineConverter,
} from "../src/adapter/global-logs.ts";
import { createLiveAdapter } from "../src/adapter/live-adapter.ts";
import { readSimulatorLogs, type SimulatorLogLine } from "../src/logs.ts";
import { parsedRecords, SIMULATOR_LOGS } from "./capture.ts";

/**
 * A stand-in for the simulator's private `logLineToTraceRecord`: it returns
 * the record TraceWriter wrote for a wire line of the same capture (HOW.md
 * checks that the 60 wire lines and the 60 records match one to one), and
 * null for every other line, as the real converter does.
 */
function captureConverter(): LogLineConverter {
  const queues = new Map<string, TraceRecord[]>();
  for (const record of parsedRecords()) {
    const key = `${record.chargePointId}\u0000${record.raw}`;
    queues.set(key, [...(queues.get(key) ?? []), record]);
  }
  return (line) => {
    const match = /^(?:Sent|Received): (.*)$/s.exec(line.message);
    if (match === null) return null;
    return queues.get(`${line.cpId}\u0000${match[1]}`)?.shift() ?? null;
  };
}

/** The capture's charge point lines as GlobalLogsProvider holds them. */
function globalEntries(): GlobalLogEntry[] {
  return readSimulatorLogs(SIMULATOR_LOGS)
    .lines.filter((line): line is SimulatorLogLine & { cpId: string } => line.cpId !== undefined)
    .map((line, index) => ({
      cpId: line.cpId,
      seq: index + 1,
      entry: { timestamp: new Date(line.timestamp), type: line.type, message: line.message },
    }));
}

/** The ring buffer after `count` lines: the newest `capacity`, newest first. */
function ringBuffer(all: readonly GlobalLogEntry[], count: number, capacity = 2000) {
  return all.slice(Math.max(0, count - capacity), count).reverse();
}

function connectedStore() {
  const store = createViewerStore();
  const live = createLiveAdapter();
  store.connect(live.adapter);
  return { store, live };
}

function ids(store: ViewerStore): string[] {
  return store.toArray().map((entry) => entry.id);
}

describe("readSimulatorLogs", () => {
  it("splits the 160 captured lines into 60 wire lines and 100 others", () => {
    const { lines, invalid } = readSimulatorLogs(SIMULATOR_LOGS);
    expect(invalid).toEqual([]);
    expect(lines).toHaveLength(160);
    expect(lines.filter((line) => line.wire)).toHaveLength(60);
    expect(lines.filter((line) => !line.wire)).toHaveLength(100);
  });

  it("reports a line that is not JSON by its number", () => {
    const { lines, invalid } = readSimulatorLogs(`[server] Shutting down...\n${SIMULATOR_LOGS}`);
    expect(invalid).toEqual([1]);
    expect(lines).toHaveLength(160);
  });
});

describe("createGlobalLogsFeed", () => {
  it("turns only the wire lines into entries, with seq-based ids", () => {
    const { store, live } = connectedStore();
    const all = globalEntries();
    const feed = createGlobalLogsFeed({ push: live.push, toRecord: captureConverter() });

    for (let count = 10; count < all.length + 10; count += 10) {
      feed.ingest(ringBuffer(all, Math.min(count, all.length)));
    }

    const entries = store.toArray();
    expect(entries).toHaveLength(60);
    expect(entries.map((entry) => (entry.kind === "trace" ? entry.record : null))).toStrictEqual(
      parsedRecords(),
    );
    const wireSeqs = all
      .filter((line) => /^(?:Sent|Received): /.test(line.entry.message))
      .map((line) => `sim-seq-${line.seq}`);
    expect(ids(store)).toEqual(wireSeqs);
  });

  it("adds nothing when the same buffer is delivered again", () => {
    const { store, live } = connectedStore();
    const all = globalEntries();
    const feed = createGlobalLogsFeed({ push: live.push, toRecord: captureConverter() });

    feed.ingest(ringBuffer(all, 40));
    const before = ids(store);
    feed.ingest(ringBuffer(all, 40));

    expect(ids(store)).toEqual(before);
    expect(store.getStats().duplicates).toBe(0);
  });

  it("lists a gap when the ring buffer dropped lines between two deliveries", () => {
    const { store, live } = connectedStore();
    const all = globalEntries();
    const feed = createGlobalLogsFeed({ push: live.push, toRecord: captureConverter() });

    feed.ingest(ringBuffer(all, 20, 20));
    feed.ingest(ringBuffer(all, 70, 20));

    const gaps = store.toArray().filter((entry) => entry.kind === "gap");
    expect(gaps).toEqual([
      {
        kind: "gap",
        id: "sim-gap-51",
        reason: "dropped",
        timestamp: all[50]?.entry.timestamp.toISOString(),
      },
    ]);
  });
});
