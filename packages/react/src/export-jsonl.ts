import { JsonlWriteError, serializeRecord } from "@open-ocpp-trace/jsonl/writer";
import type { TraceEntry, ViewerEntry } from "@open-ocpp-trace/viewer-core";

import {
  defaultSensitiveKeys,
  holdsSensitiveKey,
  RAW_SCAN_MAX,
  REDACTED,
  redactValue,
  sensitiveKeyMatcher,
  sensitiveKeySet,
} from "./inspect-format.ts";

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
    /** Trace records the SDK writer rejected, or a redacted export could not read. */
    readonly invalid: number;
  };
}

type TraceRecord = TraceEntry["record"];

/** The `by` of the `meta.redaction` marker a redacted export adds. */
const REDACTION_BY = "@open-ocpp-trace/viewer-react";

/** Record fields the schema defines as scalars: never redacted. */
const SCHEMA_SCALARS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "timestamp",
  "transport",
  "direction",
  "messageType",
  "ocppVersion",
  "chargePointId",
  "connectorId",
  "messageId",
  "action",
]);

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether `raw` can be kept in a redacted export: a JSON-transport frame no
 * longer than {@link RAW_SCAN_MAX} whose parse holds no sensitive key.
 */
function rawIsClean(transport: unknown, raw: string, isSensitive: (key: string) => boolean) {
  if (transport !== "json" || raw.length > RAW_SCAN_MAX) return false;
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return false;
  }
  return !holdsSensitiveKey(frame, isSensitive);
}

/**
 * A redacted copy of `record` (see {@link exportJsonl}). Throws when a part
 * of the record cannot be read or serialized.
 */
function redactRecord(record: TraceRecord, isSensitive: (key: string) => boolean): TraceRecord {
  // Redact a JSON snapshot, not the record: it applies every `toJSON` and
  // reads every getter once, so what is written is exactly what was checked.
  // Too deep, cyclic or otherwise unserializable, it throws.
  const source = JSON.parse(JSON.stringify(record)) as Readonly<Record<string, unknown>>;
  const fields: [string, unknown][] = [];
  let rawDropped = false;
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (SCHEMA_SCALARS.has(key)) {
      fields.push([key, value]);
    } else if (key === "raw") {
      if (typeof value === "string" && rawIsClean(source["transport"], value, isSensitive)) {
        fields.push([key, value]);
      } else {
        rawDropped = true;
      }
    } else if (key === "payload" || key === "error" || key === "meta" || !isSensitive(key)) {
      fields.push([key, redactValue(value, isSensitive)]);
    } else {
      fields.push([key, REDACTED]);
    }
  }
  // fromEntries defines own properties: a "__proto__" field stays a field.
  const out = Object.fromEntries(fields);
  // `error.code` is a schema field: a fresh copy gets it back unredacted.
  const error = source["error"];
  if (out["error"] !== error && isPlainObject(error) && Object.hasOwn(error, "code")) {
    (out["error"] as Record<string, unknown>)["code"] = error["code"];
  }
  // Only an absent meta gets one. A meta that is not an object, null
  // included, stays as is: the writer rejects the record.
  const meta = out["meta"] === undefined ? {} : out["meta"];
  if (isPlainObject(meta)) out["meta"] = { ...meta, redaction: { by: REDACTION_BY, rawDropped } };
  return out as unknown as TraceRecord;
}

/** Options of {@link exportJsonl}. */
export interface JsonlExportOptions {
  /**
   * Writes a redacted copy of each record instead of the record itself.
   * Default false: the faithful export.
   */
  readonly redact?: boolean;
  /**
   * Property names whose values a redacted export replaces, matched as the
   * inspector does. Default {@link defaultSensitiveKeys}.
   */
  readonly sensitiveKeys?: readonly string[];
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
 * By default, records are written unmodified, sensitive fields included.
 * With `options.redact`, each record is written redacted, with the
 * inspector's matching. The redaction works on the record's JSON form
 * (every `toJSON` applied, every getter read once), so what is written is
 * exactly what was checked: the value of every property named in
 * `options.sensitiveKeys` (case-insensitively, at any depth, inside arrays)
 * becomes `"[redacted]"` in `payload`, `error` (all but
 * `code`), `meta` and unknown top-level fields; schema fields are never
 * touched. `raw` is kept verbatim when it is a JSON frame no longer than
 * 1 000 000 characters whose parse holds no sensitive key, and dropped
 * otherwise (SOAP frames included); it is never rewritten. Each record then
 * gets `meta.redaction = { by: "@open-ocpp-trace/viewer-react", rawDropped }`,
 * replacing any producer value there; it names no key and no value; a
 * record without `meta` gets one, and a `null` one is rejected by the writer
 * as in the faithful export. A record the redaction cannot read or
 * serialize (a throwing getter or proxy, a cycle, too deep a nesting) is
 * counted `invalid`, never written unredacted.
 *
 * Viewer-side fields (`receivedAt`, `metadata`) are never written. Entries
 * and records are never mutated.
 */
export function exportJsonl(
  entries: Iterable<ViewerEntry>,
  options: JsonlExportOptions = {},
): JsonlExport {
  const isSensitive =
    options.redact === true
      ? sensitiveKeyMatcher(sensitiveKeySet(options.sensitiveKeys ?? defaultSensitiveKeys))
      : null;
  const lines: string[] = [];
  const skipped = { unparsed: 0, gap: 0, invalid: 0 };
  for (const entry of entries) {
    if (entry.kind !== "trace") {
      skipped[entry.kind] += 1;
      continue;
    }
    let record = entry.record;
    if (isSensitive !== null) {
      try {
        record = redactRecord(record, isSensitive);
      } catch {
        skipped.invalid += 1;
        continue;
      }
    }
    try {
      lines.push(serializeRecord(record));
    } catch (error) {
      if (!(error instanceof JsonlWriteError)) throw error;
      skipped.invalid += 1;
    }
  }
  return { text: lines.join(""), recordCount: lines.length, skipped };
}
