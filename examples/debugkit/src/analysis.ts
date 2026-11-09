import {
  ParseError,
  buildSessionTimeline,
  detectFailures,
  parseOpenOcppTrace,
  type Event,
  type Failure,
  type ParseResult,
  type ParseWarning,
} from "@ocpp-debugkit/toolkit/core";

import { mapEvents, type EventMapping } from "./mapping.ts";
import type { AnalysisSnapshot } from "./snapshot.ts";

/** DebugKit's view of one snapshot. */
export interface Analysis {
  readonly snapshot: AnalysisSnapshot;
  /** `"empty"`: nothing to send; `"error"`: DebugKit rejected the snapshot. */
  readonly status: "ok" | "empty" | "error";
  /** The ParseError message, when DebugKit rejected the snapshot. */
  readonly error?: string;
  readonly events: readonly Event[];
  /**
   * DebugKit's warnings, verbatim. Their `index` lives in several index
   * spaces (JSONL line, parsed value, schema-valid record), so a warning is
   * never attached to an entry: they are shown for the whole analysis.
   */
  readonly warnings: readonly ParseWarning[];
  readonly failures: readonly Failure[];
  readonly mapping: EventMapping;
}

/**
 * Hands the snapshot to DebugKit and maps its events back to the snapshot's
 * entries. A `ParseError` (empty document, no usable record, size or count
 * limit) is reported in the result; any other error propagates.
 */
export function analyzeSnapshot(
  snapshot: AnalysisSnapshot,
  parse: (input: string) => ParseResult = parseOpenOcppTrace,
): Analysis {
  // Built only on the early returns: the ok path maps the real events.
  const nothing = () => ({
    events: [],
    warnings: [],
    failures: [],
    mapping: mapEvents(snapshot.lines, []),
  });
  if (snapshot.text === "") return { snapshot, status: "empty", ...nothing() };
  let result: ParseResult;
  try {
    result = parse(snapshot.text);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    return { snapshot, status: "error", error: error.message, ...nothing() };
  }
  const { events, warnings } = result;
  return {
    snapshot,
    status: "ok",
    events,
    warnings,
    failures: detectFailures(events, buildSessionTimeline(events)),
    mapping: mapEvents(snapshot.lines, events),
  };
}
