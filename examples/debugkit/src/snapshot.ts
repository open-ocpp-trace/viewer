import type { TraceRecord } from "@open-ocpp-trace/core";
import { JsonlWriteError, serializeRecord } from "@open-ocpp-trace/jsonl/writer";
import type { EntryId, ViewerEntry } from "@open-ocpp-trace/viewer-core";

/** Bounds of a snapshot, kept well below DebugKit's own parse limits. */
export interface SnapshotLimits {
  /** Most lines in a snapshot (DebugKit rejects more than 10,000 events). */
  readonly maxLines: number;
  /** Most UTF-8 bytes in a snapshot (DebugKit rejects more than 10 MiB). */
  readonly maxBytes: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = {
  maxLines: 5_000,
  maxBytes: 4 * 1024 * 1024,
};

/** One line of a snapshot and the viewer entry it was written from. */
export interface SnapshotLine {
  readonly entryId: EntryId;
  readonly record: TraceRecord;
}

/**
 * The input handed to DebugKit's `parseOpenOcppTrace`: the trace entries of
 * the store, in store order, one JSONL line each, written with the SDK
 * writer. Line k was written from `lines[k]` (and `entryIds[k]`).
 */
export interface AnalysisSnapshot {
  /** JSONL text, one LF-terminated line per record; `""` when empty. */
  readonly text: string;
  readonly lines: readonly SnapshotLine[];
  readonly entryIds: readonly EntryId[];
  /**
   * The line of each entry id. The store can reuse an evicted id for a new
   * entry: only the entry whose record is this line's record was analyzed.
   */
  readonly lineByEntry: ReadonlyMap<EntryId, SnapshotLine>;
  /** Entries never sent to DebugKit, by cause. */
  readonly skipped: {
    /** Unparsed frames: not records. */
    readonly unparsed: number;
    /** Gap markers: not records. */
    readonly gap: number;
    /** Trace records the SDK writer rejected. */
    readonly invalid: number;
  };
  /** The oldest trace entries left out to stay within the limits. */
  readonly truncated: number;
}

const encoder = new TextEncoder();

/**
 * Builds the snapshot of `entries` (all the trace entries the store holds,
 * not the filtered list, so a filter change never calls for a new analysis).
 * Gap and unparsed entries never reach DebugKit; they are only counted. When
 * the trace entries exceed `limits`, the newest ones that fit are kept and
 * the others counted in `truncated`. Entries are never mutated.
 */
export function buildSnapshot(
  entries: readonly ViewerEntry[],
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
): AnalysisSnapshot {
  const skipped = { unparsed: 0, gap: 0, invalid: 0 };
  const kept: { line: SnapshotLine; text: string }[] = [];
  let bytes = 0;
  let truncated = 0;
  // Newest first, so that the limits drop the oldest lines.
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.kind !== "trace") {
      skipped[entry.kind] += 1;
      continue;
    }
    if (truncated > 0) {
      truncated += 1;
      continue;
    }
    let text: string;
    try {
      text = serializeRecord(entry.record);
    } catch (error) {
      if (!(error instanceof JsonlWriteError)) throw error;
      skipped.invalid += 1;
      continue;
    }
    const size = encoder.encode(text).length;
    if (kept.length >= limits.maxLines || bytes + size > limits.maxBytes) {
      truncated = 1;
      continue;
    }
    bytes += size;
    kept.push({ line: { entryId: entry.id, record: entry.record }, text });
  }
  kept.reverse();
  const lines = kept.map((item) => item.line);
  return {
    text: kept.map((item) => item.text).join(""),
    lines,
    entryIds: lines.map((line) => line.entryId),
    lineByEntry: new Map(lines.map((line) => [line.entryId, line])),
    skipped,
    truncated,
  };
}
