import type { ViewerEntry } from "@open-ocpp-trace/viewer-core";

import type { Analysis } from "./analysis.ts";

/** Why a viewer entry has no DebugKit event. */
export type NotAnalyzedReason =
  /** The SDK reader rejected the line: it is never sent to DebugKit. */
  | "unparsed"
  /** A gap marker is not a record: it is never sent to DebugKit. */
  | "gap"
  /** No analysis has run yet. */
  | "pending"
  /** DebugKit rejected the whole snapshot (ParseError). */
  | "rejected"
  /** DebugKit's events did not fit the snapshot: nothing is mapped. */
  | "mapping-broken"
  /** Not in the analyzed snapshot: left out by its limits, not writable, or newer. */
  | "not-sent"
  /** Several lines could be the source of one event: none is guessed. */
  | "ambiguous"
  /** DebugKit dropped the record (see its warnings). */
  | "ignored";

export type EntryStatus = { readonly eventId: string } | { readonly reason: NotAnalyzedReason };

/**
 * The DebugKit event of `entry` in `analysis`, through the identity mapping
 * only, or why there is none. Ambiguous entries are a subset of the unmapped
 * ones, so ambiguity is checked first.
 */
export function entryStatus(analysis: Analysis | undefined, entry: ViewerEntry): EntryStatus {
  if (entry.kind !== "trace") return { reason: entry.kind };
  if (analysis === undefined) return { reason: "pending" };
  const { mapping, snapshot } = analysis;
  const eventId = mapping.eventByEntry.get(entry.id);
  if (eventId !== undefined) return { eventId };
  if (analysis.status === "error") return { reason: "rejected" };
  if (mapping.status === "broken") return { reason: "mapping-broken" };
  if (!snapshot.entryIds.includes(entry.id)) return { reason: "not-sent" };
  if (mapping.ambiguousEntryIds.includes(entry.id)) return { reason: "ambiguous" };
  return { reason: "ignored" };
}
