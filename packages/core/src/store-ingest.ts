import type { EntryDelivery, EntryId, EntryMetadata, ViewerEntry } from "./entry.ts";
import { isObject, isRecord } from "./guards.ts";
import type { EntryMetadataPatch } from "./update.ts";

/**
 * Prefix of the ids the store gives its own entries (such as the gap it lists
 * when entries were dropped). An adapter `add` whose id starts with it is
 * invalid: dropped and counted.
 */
export const STORE_ID_PREFIX = "viewer-store:";

/**
 * A batch item that passed the shape checks of the « Untrusted data » rules:
 * a fresh object of the values read, each field read once. `entry` is still
 * the untrusted object (its other fields are read by
 * {@link normalizeAddedEntry}); an update's `metadata` is a null-prototype
 * snapshot of the patch's defined values.
 */
export type CheckedItem =
  | {
      readonly type: "add";
      readonly id: EntryId;
      readonly kind: ViewerEntry["kind"];
      readonly entry: object;
    }
  | {
      readonly type: "update";
      readonly id: EntryId;
      readonly revision: number | undefined;
      readonly metadata: EntryMetadataPatch;
    };

const ENTRY_KINDS: ReadonlySet<unknown> = new Set(["trace", "unparsed", "gap"]);

/** Whether a `deliveries` value is allowed: an array, `null` or `undefined`. */
function validDeliveries(deliveries: unknown): boolean {
  return deliveries === undefined || deliveries === null || Array.isArray(deliveries);
}

/**
 * Checks the shape of one untrusted batch item; `undefined` means the item is
 * invalid (dropped and counted). Only the fields the store relies on are
 * checked: the rest of an entry is opaque data. Each field is read once and
 * the values read are returned, so a getter cannot answer the check and a
 * later use differently. May throw on a hostile item (a throwing getter or
 * proxy trap): the caller counts it as invalid.
 */
export function checkItem(item: unknown): CheckedItem | undefined {
  if (!isObject(item)) return undefined;
  const type = item["type"];
  if (type === "add") {
    const entry = item["entry"];
    if (!isObject(entry)) return undefined;
    const kind = entry["kind"];
    if (!ENTRY_KINDS.has(kind)) return undefined;
    const id = entry["id"];
    if (typeof id !== "string" || id.startsWith(STORE_ID_PREFIX)) return undefined;
    return { type, id, kind: kind as ViewerEntry["kind"], entry };
  }
  if (type === "update") {
    const id = item["id"];
    if (typeof id !== "string") return undefined;
    const revision = item["revision"];
    if (revision !== undefined && !(Number.isInteger(revision) && (revision as number) >= 0)) {
      return undefined;
    }
    const patch = item["metadata"];
    if (!isRecord(patch)) return undefined;
    const metadata = definedValues(patch) ?? Object.create(null);
    if (!validDeliveries(metadata["deliveries"])) return undefined;
    return { type, id, revision: revision as number | undefined, metadata };
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
  // The position of the first delivery of each target.
  const positions = new Map<string, number>();
  for (let position = 0; position < merged.length; position++) {
    const target = targetOf(merged[position]);
    if (target !== undefined && !positions.has(target)) positions.set(target, position);
  }
  for (const delivery of patch) {
    const target = targetOf(delivery);
    const found = target === undefined ? undefined : positions.get(target);
    if (found !== undefined) {
      merged[found] = delivery;
      continue;
    }
    if (target !== undefined) positions.set(target, merged.length);
    merged.push(delivery);
  }
  return merged;
}

/** The string `target` of a delivery, read once; `undefined` otherwise. */
function targetOf(delivery: unknown): string | undefined {
  const target = isObject(delivery) ? delivery["target"] : undefined;
  return typeof target === "string" ? target : undefined;
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
 * Returns the entry to store for a checked `add`, or `undefined` when it is
 * invalid (a `deliveries` in its metadata that is neither an array, `null`
 * nor `undefined`). The entry is a copy holding the checked `kind` and `id`
 * and only the other contract fields of that kind that are defined, each read
 * once, so no field the byte accounting does not weigh is retained, and whose
 * deliveries keep the last delivery of a duplicate target (rule 5). The copy
 * keeps the same `record` and `metadata` references unless deliveries were
 * merged; the input is never mutated. A field whose getter throws is left
 * out; a throwing `deliveries` getter throws (the item is invalid).
 */
export function normalizeAddedEntry(
  checked: Extract<CheckedItem, { type: "add" }>,
): ViewerEntry | undefined {
  const copy: Record<string, unknown> = { kind: checked.kind, id: checked.id };
  for (const field of CONTRACT_FIELDS[checked.kind]) {
    if (field === "kind" || field === "id") continue;
    let value: unknown;
    try {
      value = (checked.entry as Record<string, unknown>)[field];
    } catch {
      continue;
    }
    if (value !== undefined) copy[field] = value;
  }
  const metadata = copy["metadata"];
  if (isObject(metadata)) {
    const deliveries = metadata["deliveries"];
    if (!validDeliveries(deliveries)) return undefined;
    if (Array.isArray(deliveries)) {
      const merged = mergeDeliveries([], deliveries as readonly EntryDelivery[]);
      if (merged.length !== deliveries.length) {
        copy["metadata"] = { ...metadata, deliveries: merged };
      }
    }
  }
  return copy as unknown as ViewerEntry;
}
