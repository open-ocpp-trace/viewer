import type { Correlator } from "./correlation.ts";
import type { ViewerEntry } from "./entry.ts";
import type { FilterFieldDefinition } from "./extension.ts";
import type { CompiledFilter, Selection, StringProperty } from "./filter-model.ts";

/** What the predicate reads beside the entry. */
export interface MatchContext {
  /** Declared producer fields, by id. */
  readonly fields: ReadonlyMap<string, FilterFieldDefinition>;
  /** Source of derived actions. */
  readonly correlator?: Pick<Correlator, "get">;
}

/** Reads one property of untrusted data; never throws. */
function read(object: unknown, key: string): unknown {
  try {
    return typeof object === "object" && object !== null
      ? (object as Readonly<Record<string, unknown>>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** The record of a trace entry, else undefined. */
function recordOf(entry: ViewerEntry): unknown {
  return entry.kind === "trace" ? read(entry, "record") : undefined;
}

function derivedAction(entry: ViewerEntry, ctx: MatchContext): unknown {
  try {
    return ctx.correlator?.get(entry.id)?.action;
  } catch {
    return undefined;
  }
}

/** The value of a single-valued string property of an entry; null when absent. */
export function stringValue(
  entry: ViewerEntry,
  property: StringProperty,
  ctx: MatchContext,
): string | null {
  const record = recordOf(entry);
  const metadata = read(entry, "metadata");
  switch (property) {
    case "chargePointIds":
      return text(
        entry.kind === "trace"
          ? (read(record, "chargePointId") ?? read(metadata, "chargePointId"))
          : read(metadata, "chargePointId"),
      );
    case "actions":
      return entry.kind === "trace"
        ? text(read(record, "action") ?? derivedAction(entry, ctx))
        : null;
    case "directions":
      return text(entry.kind === "unparsed" ? read(entry, "direction") : read(record, "direction"));
    case "ocppVersions":
      return text(read(record, "ocppVersion"));
    case "messageTypes":
      return text(read(record, "messageType"));
    case "messageIds":
      return text(read(record, "messageId"));
    case "sessionIds":
      return text(read(metadata, "sessionId"));
    case "tenants":
      return text(read(metadata, "tenant"));
    case "sourceIds":
      return text(read(read(metadata, "source"), "id"));
  }
}

/** The connector of a trace entry: an integer >= 0, else null. */
export function connectorValue(entry: ViewerEntry): number | null {
  const value = read(recordOf(entry), "connectorId");
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Strings of an untrusted list, dropping other items; empty if not a list. */
function stringItems(value: unknown, pick: (item: unknown) => unknown): string[] {
  if (!Array.isArray(value)) return [];
  const found: string[] = [];
  try {
    for (const item of value as readonly unknown[]) {
      const picked = pick(item);
      if (typeof picked === "string" && !found.includes(picked)) found.push(picked);
    }
  } catch {
    // A hostile list stops the read; keep what was read.
  }
  return found;
}

/** Distinct delivery statuses of an entry; empty when it has none. */
export function deliveryStatuses(entry: ViewerEntry): readonly string[] {
  return stringItems(read(read(entry, "metadata"), "deliveries"), (item) => read(item, "status"));
}

/** Distinct string values of a producer field; empty (absent) if `values` misbehaves. */
export function fieldValues(
  entry: ViewerEntry,
  definition: FilterFieldDefinition,
): readonly string[] {
  let values: unknown;
  try {
    values = definition.values(entry);
  } catch {
    return [];
  }
  return stringItems(values, (item) => item);
}

/** The entry's time in epoch milliseconds, or undefined. */
export function timeValue(entry: ViewerEntry): number | undefined {
  const own =
    entry.kind === "trace" ? read(recordOf(entry), "timestamp") : read(entry, "timestamp");
  const value = own ?? read(entry, "receivedAt");
  if (typeof value !== "string") return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

function selectsAny<T>(selection: Selection<T>, values: readonly T[]): boolean {
  if (values.length === 0) return selection.has(null);
  return values.some((value) => selection.has(value));
}

/**
 * Whether `entry` matches the compiled filter. Pure: it reads the entry,
 * the producer fields and the correlator, never writes, and never throws on
 * untrusted data. A gap is tested on `kinds` only.
 */
export function matchesFilter(
  entry: ViewerEntry,
  compiled: CompiledFilter,
  ctx: MatchContext,
): boolean {
  if (compiled.kinds !== undefined && !compiled.kinds.has(entry.kind)) return false;
  if (entry.kind === "gap") return true;
  if (compiled.from !== undefined || compiled.to !== undefined) {
    const time = timeValue(entry);
    if (time === undefined) return false;
    if (compiled.from !== undefined && time < compiled.from) return false;
    if (compiled.to !== undefined && time >= compiled.to) return false;
  }
  for (const { property, values } of compiled.strings) {
    if (!values.has(stringValue(entry, property, ctx))) return false;
  }
  if (compiled.connectorIds !== undefined && !compiled.connectorIds.has(connectorValue(entry))) {
    return false;
  }
  if (
    compiled.deliveryStatuses !== undefined &&
    !selectsAny(compiled.deliveryStatuses, deliveryStatuses(entry))
  ) {
    return false;
  }
  for (const { definition, values } of compiled.fields) {
    if (!selectsAny(values, fieldValues(entry, definition))) return false;
  }
  return true;
}
