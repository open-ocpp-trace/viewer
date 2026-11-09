import type { Correlator } from "./correlation.ts";
import type { ViewerEntry } from "./entry.ts";
import type { FilterFieldDefinition } from "./extension.ts";
import { connectorValue, type MatchContext, read, stringValue } from "./filter-extract.ts";

/**
 * The display values of an entry, read with the same extractors as
 * `TraceFilter`, so a cell shows the value a filter selects. `null` means
 * absent: a value of the wrong runtime type is absent too. Values are not
 * formatted.
 */
export interface EntryFields {
  /** The record's timestamp, or an unparsed entry's or gap's, as received. */
  readonly timestamp: string | null;
  /** `record.chargePointId ?? metadata.chargePointId` for a trace entry, else the metadata's. */
  readonly chargePointId: string | null;
  readonly connectorId: number | null;
  readonly direction: string | null;
  readonly messageType: string | null;
  /** `record.action`, else the action the correlator derived. */
  readonly action: string | null;
  readonly messageId: string | null;
}

const NO_FIELDS: ReadonlyMap<string, FilterFieldDefinition> = new Map();

/** Reads the display values of `entry`; never throws on untrusted data. */
export function readEntryFields(entry: ViewerEntry, correlator?: Correlator): EntryFields {
  const ctx: MatchContext = { fields: NO_FIELDS, ...(correlator !== undefined && { correlator }) };
  const timestamp =
    entry.kind === "trace" ? read(read(entry, "record"), "timestamp") : read(entry, "timestamp");
  return {
    timestamp: typeof timestamp === "string" ? timestamp : null,
    chargePointId: stringValue(entry, "chargePointIds", ctx),
    connectorId: connectorValue(entry),
    direction: stringValue(entry, "directions", ctx),
    messageType: stringValue(entry, "messageTypes", ctx),
    action: stringValue(entry, "actions", ctx),
    messageId: stringValue(entry, "messageIds", ctx),
  };
}
