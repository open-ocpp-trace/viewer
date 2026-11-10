/**
 * Simulator-side adapter, live half: the shape of a feed from the
 * simulator web UI's `GlobalLogsProvider`, which keeps the latest log
 * entries of every charge point in a ring buffer, newest first, each with a
 * sequence number. The log-line-to-record conversion is the simulator's
 * own (`logLineToTraceRecord` of its private `@ocpp-cp-simulator/trace`
 * package), so it is injected: this example cannot import it.
 */
import type { TraceRecord } from "@open-ocpp-trace/core";
import type { GapEntry, ViewerEntry } from "@open-ocpp-trace/viewer-core";

import { simulatorTraceEntry } from "./trace-reader.ts";

/** A log line as the simulator's JSON log format serializes it. */
export interface SerializedLogLine {
  readonly timestamp: string;
  readonly level?: string;
  readonly type?: string;
  readonly message: string;
  readonly cpId?: string;
}

/** One entry of `GlobalLogsProvider`, reduced to what the feed reads. */
export interface GlobalLogEntry {
  readonly cpId: string;
  readonly seq: number;
  readonly entry: {
    readonly timestamp: Date;
    readonly level?: string;
    readonly type?: string;
    readonly message: string;
  };
}

/**
 * Maps a log line to a record, or null for a line that is not a wire frame
 * (application, scenario or SOAP lines, unparseable frames). In a real
 * integration, `(line) => logLineToTraceRecord(line, { ocppVersion })`,
 * followed by a `TraceCorrelator` to back-fill response actions.
 */
export type LogLineConverter = (line: SerializedLogLine) => TraceRecord | null;

export interface GlobalLogsFeedOptions {
  readonly toRecord: LogLineConverter;
  /** Usually `LiveAdapter.push`. */
  readonly push: (entries: readonly ViewerEntry[]) => void;
}

export interface GlobalLogsFeed {
  /**
   * Takes the provider's whole buffer, newest first, as it re-renders, and
   * pushes the entries of the lines not seen yet, oldest first.
   */
  ingest(buffer: readonly GlobalLogEntry[]): void;
}

/**
 * Ids are `sim-seq-<seq>`: stable for a line however many times the buffer
 * is delivered. Lines the converter rejects are skipped, not turned into
 * unparsed entries: a log line is not a frame. When the ring buffer dropped
 * lines between two deliveries, a `dropped` gap is listed before the first
 * new line, since some of them may have been frames.
 */
export function createGlobalLogsFeed(options: GlobalLogsFeedOptions): GlobalLogsFeed {
  let lastSeq: number | undefined;
  return {
    ingest(buffer) {
      const fresh = buffer
        .filter((item) => lastSeq === undefined || item.seq > lastSeq)
        .sort((a, b) => a.seq - b.seq);
      const [first] = fresh;
      if (first === undefined) return;

      const entries: ViewerEntry[] = [];
      if (lastSeq !== undefined && first.seq > lastSeq + 1) {
        const gap: GapEntry = {
          kind: "gap",
          id: `sim-gap-${first.seq}`,
          reason: "dropped",
          timestamp: first.entry.timestamp.toISOString(),
        };
        entries.push(gap);
      }
      for (const { cpId, seq, entry } of fresh) {
        const record = options.toRecord({
          timestamp: entry.timestamp.toISOString(),
          message: entry.message,
          cpId,
          ...(entry.level !== undefined && { level: entry.level }),
          ...(entry.type !== undefined && { type: entry.type }),
        });
        if (record !== null) entries.push(simulatorTraceEntry(`sim-seq-${seq}`, record));
      }
      lastSeq = fresh[fresh.length - 1]?.seq ?? lastSeq;
      options.push(entries);
    },
  };
}
