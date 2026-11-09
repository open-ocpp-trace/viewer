/**
 * Compile-only sketch of an OCPP CP Simulator adapter, checking that the
 * entry contract fits the simulator's log-to-trace mapping. The input types
 * are local and minimal on purpose: the viewer never imports simulator code.
 */
import type { TraceRecord } from "@open-ocpp-trace/core";
import type {
  EntryId,
  EntryUpdate,
  TraceEntry,
  Unsubscribe,
  UnparsedEntry,
  ViewerAdapter,
  ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

/** A simulator log line, as its JSON log format serialises it. */
export interface SimulatorLogLine {
  timestamp: string;
  message: string;
  cpId?: string;
}

/**
 * The outcome of the simulator's own log-to-trace mapping for one wire frame:
 * either a conformant record, or the reason the frame could not be one.
 */
export type SimulatorFrame =
  | { line: SimulatorLogLine; record: TraceRecord }
  | {
      line: SimulatorLogLine;
      record: null;
      reason: string;
      direction?: TraceRecord["direction"];
    };

/** Producer context the simulator knows beside the record, if any. */
export interface SimulatorContext {
  chargePointId?: string;
  sessionId?: string;
}

/** Wraps a record as is: no copy, no mutation, metadata only when known. */
export function simulatorTraceEntry(
  id: EntryId,
  record: TraceRecord,
  context?: SimulatorContext,
): TraceEntry {
  if (context === undefined) return { kind: "trace", id, record };
  return {
    kind: "trace",
    id,
    record,
    metadata: {
      ...(context.chargePointId !== undefined && { chargePointId: context.chargePointId }),
      ...(context.sessionId !== undefined && { sessionId: context.sessionId }),
      source: { id: "simulator", label: "OCPP CP Simulator" },
    },
  };
}

/** A frame the simulator logged but could not map to a conformant record. */
export function simulatorUnparsedEntry(
  id: EntryId,
  line: SimulatorLogLine,
  reason: string,
  direction?: TraceRecord["direction"],
): UnparsedEntry {
  return {
    kind: "unparsed",
    id,
    raw: line.message,
    reason,
    timestamp: line.timestamp,
    transport: "json",
    ...(direction !== undefined && { direction }),
    ...(line.cpId !== undefined && { metadata: { chargePointId: line.cpId } }),
  };
}

/** Maps one simulator frame to a viewer entry. */
export function simulatorEntry(
  id: EntryId,
  frame: SimulatorFrame,
  context?: SimulatorContext,
): ViewerEntry {
  if (frame.record !== null) return simulatorTraceEntry(id, frame.record, context);
  return simulatorUnparsedEntry(id, frame.line, frame.reason, frame.direction);
}

/** An in-memory simulator adapter: a snapshot of past frames, then pushes. */
export interface SimulatorAdapter {
  adapter: ViewerAdapter;
  push: (frame: SimulatorFrame) => void;
}

export function createSimulatorAdapter(
  history: readonly SimulatorFrame[],
  context?: SimulatorContext,
): SimulatorAdapter {
  let nextId = 0;
  const idOf = (): EntryId => `sim-${nextId++}`;
  const snapshot = history.map((frame) => simulatorEntry(idOf(), frame, context));
  const listeners = new Set<(updates: readonly EntryUpdate[]) => void>();

  return {
    adapter: {
      snapshot: () => snapshot,
      subscribe(listener): Unsubscribe {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    push(frame) {
      const updates: readonly EntryUpdate[] = [
        { type: "add", entry: simulatorEntry(idOf(), frame, context) },
      ];
      for (const listener of listeners) listener(updates);
    },
  };
}
