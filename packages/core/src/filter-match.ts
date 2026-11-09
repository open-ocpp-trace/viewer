import type { ViewerEntry } from "./entry.ts";
import {
  connectorValue,
  deliveryStatuses,
  fieldValues,
  type MatchContext,
  stringValue,
  timeValue,
} from "./filter-extract.ts";
import type { CompiledFilter, Selection } from "./filter-model.ts";
import { matchesText } from "./filter-search.ts";

export type { MatchContext } from "./filter-extract.ts";

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
  return compiled.text === undefined || matchesText(entry, compiled.text, ctx, compiled.payloads);
}
