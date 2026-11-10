/**
 * The state the page controls, filter and selection, kept in the URL hash
 * so a view can be bookmarked or shared: `#cp=CP002&type=CALLERROR&sel=sim-24`.
 */
import type { TraceFilter, ViewerSelection } from "@open-ocpp-trace/viewer-core";

export interface HostState {
  readonly filter: TraceFilter;
  readonly selection: ViewerSelection;
}

/** The string groups of the filter the page keeps in the hash. */
const GROUPS = [
  ["cp", "chargePointIds"],
  ["dir", "directions"],
  ["type", "messageTypes"],
  ["action", "actions"],
] as const;

/** Producer fields are kept as `f.<id>=<values>`. */
const FIELD_PREFIX = "f.";

function join(values: readonly (string | null)[]): string {
  return values.map((value) => encodeURIComponent(value ?? "")).join(",");
}

function split(value: string): string[] {
  return value.split(",").map((part) => decodeURIComponent(part));
}

export function encodeHostState(state: HostState): string {
  const parts: string[] = [];
  for (const [key, group] of GROUPS) {
    const values = state.filter[group];
    if (values !== undefined && values.length > 0) parts.push(`${key}=${join(values)}`);
  }
  for (const field of state.filter.fields ?? []) {
    if (field.values.length > 0) {
      parts.push(`${FIELD_PREFIX}${encodeURIComponent(field.id)}=${join(field.values)}`);
    }
  }
  if (state.selection.entryId !== null) {
    parts.push(`sel=${encodeURIComponent(state.selection.entryId)}`);
  }
  return parts.length === 0 ? "" : `#${parts.join("&")}`;
}

/** Reads a hash written by {@link encodeHostState}; unknown keys are ignored. */
export function decodeHostState(hash: string): HostState {
  const filter: Record<string, unknown> = {};
  const fields: { id: string; values: string[] }[] = [];
  let entryId: string | null = null;
  for (const part of hash.replace(/^#/, "").split("&")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const key = part.slice(0, at);
    const value = part.slice(at + 1);
    const group = GROUPS.find(([name]) => name === key)?.[1];
    if (group !== undefined) filter[group] = split(value);
    else if (key.startsWith(FIELD_PREFIX)) {
      fields.push({ id: decodeURIComponent(key.slice(FIELD_PREFIX.length)), values: split(value) });
    } else if (key === "sel") entryId = decodeURIComponent(value);
  }
  if (fields.length > 0) filter["fields"] = fields;
  return { filter: filter as TraceFilter, selection: { entryId } };
}
