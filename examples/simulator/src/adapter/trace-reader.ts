/**
 * Simulator-side adapter, file half: reads the JSONL that the simulator's
 * TraceWriter (`--trace-output`) writes, with the released SDK reader, and
 * wraps each record as a viewer entry. It lives in this example, not in the
 * viewer packages: the viewer never imports simulator code.
 */
import type { TraceRecord } from "@open-ocpp-trace/core";
import { type JsonlReadErrorKind, readRecords } from "@open-ocpp-trace/jsonl";
import type { EntryId, EntrySource, TraceEntry } from "@open-ocpp-trace/viewer-core";

/** The producer named in each entry's metadata. */
export const SIMULATOR_SOURCE: EntrySource = { id: "simulator", label: "OCPP CP Simulator" };

/** A line of the trace file that is not a readable record. */
export interface TraceIssue {
  /** 1-based line number in the file. */
  readonly line: number;
  readonly kind: JsonlReadErrorKind;
  readonly message: string;
}

/** The readable records of a trace file, and why the other lines are not. */
export interface SimulatorTrace {
  readonly entries: readonly TraceEntry[];
  readonly issues: readonly TraceIssue[];
}

/**
 * Wraps a record as is: no copy, no mutation. The record already carries
 * the charge point; the metadata repeats it (ADR 0001 precedence keeps the
 * record's value) and names the simulator as the source.
 */
export function simulatorTraceEntry(id: EntryId, record: TraceRecord): TraceEntry {
  return {
    kind: "trace",
    id,
    record,
    metadata: {
      ...(record.chargePointId !== undefined && { chargePointId: record.chargePointId }),
      source: SIMULATOR_SOURCE,
    },
  };
}

/**
 * Reads a TraceWriter file. Ids are `sim-<line>`, from the 1-based line the
 * SDK reports, so a reload gives the same ids and a blank line shifts
 * nothing. An unreadable line becomes a {@link TraceIssue} for the page to
 * show, never an entry: it is a broken file line, not a captured frame.
 */
export async function readSimulatorTrace(text: string): Promise<SimulatorTrace> {
  const entries: TraceEntry[] = [];
  const issues: TraceIssue[] = [];
  for await (const result of readRecords([text], { onError: "yield" })) {
    if (result.ok) {
      entries.push(simulatorTraceEntry(`sim-${result.line}`, result.record));
    } else {
      const { line, kind, message } = result.error;
      issues.push({ line, kind, message });
    }
  }
  return { entries, issues };
}
