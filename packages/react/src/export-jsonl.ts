import { JsonlWriteError, serializeRecord } from "@open-ocpp-trace/jsonl/writer";
import type { ViewerEntry } from "@open-ocpp-trace/viewer-core";

/** The result of {@link exportJsonl}. */
export interface JsonlExport {
  /** JSONL text, one LF-terminated line per record; `""` when nothing was exported. */
  readonly text: string;
  /** The number of lines in `text`. */
  readonly recordCount: number;
  /** Entries left out, by cause. */
  readonly skipped: {
    /** Unparsed frames: not records, never written. */
    readonly unparsed: number;
    /** Gap markers: not records, never written. */
    readonly gap: number;
    /** Trace records the SDK writer rejected. */
    readonly invalid: number;
  };
}

/**
 * Writes the records of `entries` as JSONL, in input order, with the SDK
 * writer (`serializeRecord`, validation on). Only trace entries are written:
 * gap and unparsed entries are counted in `skipped`, and so is a record the
 * writer rejects (`JsonlWriteError`), so one bad record never fails the whole
 * export. A record too deeply nested for `JSON.stringify` is such a record:
 * the writer reports the stack overflow as an `unserializable` error. Any
 * other error propagates.
 *
 * Records are written unmodified, sensitive fields included: the inspector's
 * redaction does not apply. Viewer-side fields (`receivedAt`, `metadata`)
 * are never written. Entries and records are never mutated.
 */
export function exportJsonl(entries: Iterable<ViewerEntry>): JsonlExport {
  const lines: string[] = [];
  const skipped = { unparsed: 0, gap: 0, invalid: 0 };
  for (const entry of entries) {
    if (entry.kind !== "trace") {
      skipped[entry.kind] += 1;
      continue;
    }
    try {
      lines.push(serializeRecord(entry.record));
    } catch (error) {
      if (!(error instanceof JsonlWriteError)) throw error;
      skipped.invalid += 1;
    }
  }
  return { text: lines.join(""), recordCount: lines.length, skipped };
}
