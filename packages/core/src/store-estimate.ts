import type { ViewerEntry } from "./entry.ts";

/** Bytes counted for a number, boolean, null, BigInt, symbol or function. */
const SCALAR_BYTES = 8;
/** Bytes counted for an object or array, besides its keys and values. */
const OBJECT_BYTES = 16;
/** Bytes counted per object key, besides the key's characters. */
const KEY_BYTES = 8;
/** Bytes counted per entry, besides its record or raw frame. */
const ENTRY_BYTES = 64;
/** Nesting below this depth is counted as one opaque object. */
const MAX_DEPTH = 32;
/** Values visited per estimate; the rest of the value is not walked. */
const MAX_NODES = 100_000;

/**
 * Approximates the bytes retained by an untrusted value: about 2 bytes per
 * string character, {@link SCALAR_BYTES} per scalar, plus per-object and
 * per-key overheads. Never throws and never loops: cycles and shared objects
 * are counted once, getters or proxies that throw count as scalars, and the
 * walk stops past {@link MAX_DEPTH}, {@link MAX_NODES} or once the total
 * exceeds `limit` (the result is then above `limit`, not exact). Never uses
 * `JSON.stringify`.
 */
export function estimateBytes(value: unknown, limit: number): number {
  const visited = new WeakSet<object>();
  let nodes = 0;
  let total = 0;

  const walk = (current: unknown, depth: number): void => {
    nodes++;
    if (typeof current === "string") {
      total += current.length * 2;
      return;
    }
    if (typeof current !== "object" || current === null) {
      total += SCALAR_BYTES;
      return;
    }
    total += OBJECT_BYTES;
    if (visited.has(current) || depth >= MAX_DEPTH) return;
    visited.add(current);
    try {
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length && !exhausted(); i++) walk(current[i], depth + 1);
        return;
      }
      for (const key of Object.keys(current)) {
        if (exhausted()) return;
        total += key.length * 2 + KEY_BYTES;
        let child: unknown;
        try {
          child = (current as Record<string, unknown>)[key];
        } catch {
          child = undefined;
        }
        walk(child, depth + 1);
      }
    } catch {
      // A proxy trap threw: what was counted so far stands.
    }
  };
  const exhausted = (): boolean => total > limit || nodes >= MAX_NODES;

  walk(value, 0);
  return total;
}

/**
 * Weight of the parts of an entry an update never changes: the record of a
 * trace, the raw frame and reason of an unparsed entry, a constant for a gap.
 * Computed once when the entry is added.
 */
export function coreWeight(entry: ViewerEntry, limit: number): number {
  const base = ENTRY_BYTES + entry.id.length * 2;
  switch (entry.kind) {
    case "trace":
      return base + estimateBytes(entry.record, limit);
    case "unparsed":
      return base + estimateBytes(entry.raw, limit) + estimateBytes(entry.reason, limit);
    default:
      return base;
  }
}

/** Weight of an entry's metadata, recomputed when an update changes it. */
export function metadataWeight(entry: ViewerEntry, limit: number): number {
  return entry.metadata === undefined ? 0 : estimateBytes(entry.metadata, limit);
}
