import type { ViewerEntry } from "./entry.ts";
import {
  deliveryStatuses,
  deliveryTargets,
  fieldValues,
  type MatchContext,
  read,
  stringValue,
} from "./filter-extract.ts";
import type { StringProperty } from "./filter-model.ts";

/** Characters scanned per entry and per scope (metadata, payloads). */
export const SEARCH_BUDGET = 64 * 1024;
/** Nesting levels walked below a payload value. */
export const SEARCH_DEPTH = 32;

const SEARCHED_PROPERTIES: readonly StringProperty[] = [
  "messageIds",
  "actions",
  "chargePointIds",
  "ocppVersions",
  "messageTypes",
  "directions",
  "sessionIds",
  "tenants",
  "sourceIds",
];

/** A per-entry character budget; each string is scanned on its prefix only. */
interface Budget {
  remaining: number;
}

function scan(value: string, needle: string, budget: Budget): boolean {
  if (budget.remaining <= 0) return false;
  const prefix = value.length > budget.remaining ? value.slice(0, budget.remaining) : value;
  budget.remaining -= prefix.length;
  return prefix.toLowerCase().includes(needle);
}

/** The metadata strings a default search reads. */
function metadataTexts(entry: ViewerEntry, ctx: MatchContext): unknown[] {
  const metadata = read(entry, "metadata");
  const texts: unknown[] = [read(entry, "id")];
  for (const property of SEARCHED_PROPERTIES) texts.push(stringValue(entry, property, ctx));
  if (entry.kind === "trace") texts.push(read(read(read(entry, "record"), "error"), "code"));
  if (entry.kind === "unparsed") texts.push(read(entry, "reason"));
  texts.push(read(metadata, "conversationId"), read(read(metadata, "source"), "label"));
  texts.push(...deliveryTargets(entry), ...deliveryStatuses(entry));
  for (const definition of ctx.fields.values()) texts.push(...fieldValues(entry, definition));
  return texts;
}

/** The opaque values a payload search walks; never `record.meta` or `metadata.custom`. */
function payloadValues(entry: ViewerEntry): unknown[] {
  if (entry.kind === "unparsed") return [read(entry, "raw")];
  if (entry.kind !== "trace") return [];
  const record = read(entry, "record");
  const error = read(record, "error");
  return [
    read(record, "payload"),
    read(record, "raw"),
    read(error, "description"),
    read(error, "details"),
  ];
}

/**
 * Walks string and number leaves depth-first, within the budget (every
 * node costs at least one character) and the depth cap, visiting each
 * object once. Never throws: a throwing getter or proxy trap skips its
 * value. Never calls `JSON.stringify` or `toString` on the data.
 */
function walk(roots: readonly unknown[], needle: string, budget: Budget): boolean {
  const stack: { readonly value: unknown; readonly depth: number }[] = [];
  for (let i = roots.length - 1; i >= 0; i -= 1) stack.push({ value: roots[i], depth: 0 });
  const visited = new Set<object>();
  while (stack.length > 0 && budget.remaining > 0) {
    const { value, depth } = stack.pop()!;
    if (typeof value === "string") {
      if (scan(value, needle, budget)) return true;
      continue;
    }
    if (typeof value === "number") {
      if (scan(String(value), needle, budget)) return true;
      continue;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) continue;
    visited.add(value);
    budget.remaining -= 1;
    if (depth >= SEARCH_DEPTH) continue;
    let keys: string[];
    try {
      keys = Object.keys(value);
    } catch {
      continue;
    }
    const count = Math.min(keys.length, budget.remaining);
    for (let i = count - 1; i >= 0; i -= 1) {
      stack.push({ value: read(value, keys[i]!), depth: depth + 1 });
    }
  }
  return false;
}

/**
 * Whether `needle` (trimmed, lower-cased) occurs in the entry's searchable
 * metadata, or with `payloads` in its opaque payloads too. Gaps always
 * match. Matches beyond {@link SEARCH_BUDGET} characters or
 * {@link SEARCH_DEPTH} levels are missed.
 */
export function matchesText(
  entry: ViewerEntry,
  needle: string,
  ctx: MatchContext,
  payloads: boolean,
): boolean {
  if (entry.kind === "gap") return true;
  const budget: Budget = { remaining: SEARCH_BUDGET };
  for (const value of metadataTexts(entry, ctx)) {
    if (typeof value === "string" && scan(value, needle, budget)) return true;
  }
  return payloads && walk(payloadValues(entry), needle, { remaining: SEARCH_BUDGET });
}
