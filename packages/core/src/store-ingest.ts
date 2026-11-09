import type { EntryDelivery, EntryId, ViewerEntry } from "./entry.ts";
import type { EntryMetadataPatch } from "./update.ts";

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
    if (typeof entry["id"] !== "string") return undefined;
    return { type: "add", entry: entry as unknown as ViewerEntry };
  }
  if (item["type"] === "update") {
    const metadata = item["metadata"];
    if (typeof item["id"] !== "string") return undefined;
    if (!isObject(metadata) || Array.isArray(metadata)) return undefined;
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
 * Returns the entry to store for an `add`: the entry itself, or a copy whose
 * deliveries keep the last delivery of a duplicate target (rule 5). The copy
 * keeps the same `record` reference; the input is never mutated.
 */
export function normalizeAddedEntry(entry: ViewerEntry): ViewerEntry {
  const metadata: unknown = entry.metadata;
  if (!isObject(metadata) || !Array.isArray(metadata["deliveries"])) return entry;
  const deliveries = metadata["deliveries"] as readonly EntryDelivery[];
  const merged = mergeDeliveries([], deliveries);
  if (merged.length === deliveries.length) return entry;
  return { ...entry, metadata: { ...entry.metadata, deliveries: merged } };
}
