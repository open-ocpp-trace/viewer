import type { EntryDelivery, EntryId, EntryMetadata, ViewerEntry } from "./entry.ts";
import type { EntryMetadataPatch } from "./update.ts";

/**
 * Prefix of the ids the store gives its own entries (such as the gap it lists
 * when entries were dropped). An adapter `add` whose id starts with it is
 * invalid: dropped and counted.
 */
export const STORE_ID_PREFIX = "viewer-store:";

/** A batch item that passed the shape checks of the « Untrusted data » rules. */
export type CheckedItem =
  | { readonly type: "add"; readonly entry: ViewerEntry }
  | {
      readonly type: "update";
      readonly id: EntryId;
      readonly revision?: number;
      readonly metadata: EntryMetadataPatch;
    };

const ENTRY_KINDS: ReadonlySet<unknown> = new Set(["trace", "unparsed", "gap"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** An object that is not an array, merged per key. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}

/**
 * Checks the shape of one untrusted batch item; `undefined` means the item is
 * invalid (dropped and counted). Only the fields the store relies on are
 * checked: the rest of an entry is opaque data.
 */
export function checkItem(item: unknown): CheckedItem | undefined {
  if (!isObject(item)) return undefined;
  if (item["type"] === "add") {
    const entry = item["entry"];
    if (!isObject(entry) || !ENTRY_KINDS.has(entry["kind"])) return undefined;
    const id = entry["id"];
    if (typeof id !== "string" || id.startsWith(STORE_ID_PREFIX)) return undefined;
    return { type: "add", entry: entry as unknown as ViewerEntry };
  }
  if (item["type"] === "update") {
    const metadata = item["metadata"];
    if (typeof item["id"] !== "string") return undefined;
    if (!isObject(metadata) || Array.isArray(metadata)) return undefined;
    const revision = item["revision"];
    if (revision !== undefined && !(Number.isInteger(revision) && (revision as number) >= 0)) {
      return undefined;
    }
    return item as unknown as CheckedItem;
  }
  return undefined;
}

/**
 * Merges deliveries per `target` (rule 5): a delivery replaces the one with
 * the same target whole, in its position; a new target is appended. Items
 * without a string target are kept as opaque data and never merged.
 */
export function mergeDeliveries(
  base: readonly EntryDelivery[],
  patch: readonly EntryDelivery[],
): readonly EntryDelivery[] {
  const merged = [...base];
  const positions = new Map<string, number>();
  const index = (delivery: unknown, position: number): number | undefined => {
    const target = isObject(delivery) ? delivery["target"] : undefined;
    if (typeof target !== "string") return undefined;
    const found = positions.get(target);
    if (found === undefined) positions.set(target, position);
    return found;
  };
  merged.forEach((delivery, position) => index(delivery, position));
  for (const delivery of patch) {
    const found = index(delivery, merged.length);
    if (found === undefined) merged.push(delivery);
    else merged[found] = delivery;
  }
  return merged;
}

/**
 * Copies the defined values of an untrusted object into a null-prototype
 * object, so `__proto__` or `constructor` is just a key; `undefined` values
 * are skipped. Returns `undefined` when no value is defined.
 */
function definedValues(value: object): Record<string, unknown> | undefined {
  let defined: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    defined ??= Object.create(null) as Record<string, unknown>;
    defined[key] = child;
  }
  return defined;
}

/**
 * Merges a metadata patch (rule 5): shallowly per field, `custom` per key
 * into a null-prototype object, `deliveries` per target. An `undefined`
 * value is ignored and `null` is stored. Returns `undefined` when the patch
 * defines no value, so the entry is left as is.
 */
export function mergeMetadata(base: unknown, patch: EntryMetadataPatch): EntryMetadata | undefined {
  const defined = definedValues(patch);
  if (defined === undefined) return undefined;
  const current: Record<string, unknown> = isRecord(base) ? base : {};
  const custom = defined["custom"];
  if (isRecord(custom)) {
    const kept = definedValues(custom);
    const existing = current["custom"];
    if (kept === undefined) delete defined["custom"];
    else if (isRecord(existing))
      defined["custom"] = Object.assign(Object.create(null), existing, kept);
    else defined["custom"] = kept;
    if (Object.keys(defined).length === 0) return undefined;
  }
  const deliveries = defined["deliveries"];
  if (Array.isArray(deliveries)) {
    const existing = current["deliveries"];
    defined["deliveries"] = mergeDeliveries(Array.isArray(existing) ? existing : [], deliveries);
  }
  return { ...current, ...defined };
}

const BASE_FIELDS = ["kind", "id", "receivedAt", "metadata"] as const;

/** The contract fields of each entry kind (see `entry.ts`): all a copy keeps. */
const CONTRACT_FIELDS: Readonly<Record<ViewerEntry["kind"], readonly string[]>> = {
  trace: [...BASE_FIELDS, "record"],
  unparsed: [...BASE_FIELDS, "raw", "reason", "timestamp", "direction", "transport"],
  gap: [...BASE_FIELDS, "reason", "timestamp", "missedCount"],
};

/**
 * Returns the entry to store for an `add`: a copy holding only the contract
 * fields of its kind that are defined, so no field the byte accounting does
 * not weigh is retained, and whose deliveries keep the last delivery of a
 * duplicate target (rule 5). The copy keeps the same `record` and `metadata`
 * references unless deliveries were merged; the input is never mutated. A
 * field whose getter throws is left out.
 */
export function normalizeAddedEntry(entry: ViewerEntry): ViewerEntry {
  const copy: Record<string, unknown> = {};
  for (const field of CONTRACT_FIELDS[entry.kind]) {
    let value: unknown;
    try {
      value = (entry as unknown as Record<string, unknown>)[field];
    } catch {
      continue;
    }
    if (value !== undefined) copy[field] = value;
  }
  const metadata = copy["metadata"];
  if (isObject(metadata) && Array.isArray(metadata["deliveries"])) {
    const deliveries = metadata["deliveries"] as readonly EntryDelivery[];
    const merged = mergeDeliveries([], deliveries);
    if (merged.length !== deliveries.length) copy["metadata"] = { ...metadata, deliveries: merged };
  }
  return copy as unknown as ViewerEntry;
}
