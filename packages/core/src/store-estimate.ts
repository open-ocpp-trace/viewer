import type { ViewerEntry } from "./entry.ts";

/** Bytes counted for a number, boolean, null, BigInt, symbol or function. */
const SCALAR_BYTES = 8;
/** Bytes counted for an object or array, besides its keys and values. */
const OBJECT_BYTES = 16;
/** Bytes counted per object key, besides the key's characters. */
const KEY_BYTES = 8;
/** Bytes counted per entry, besides its id and other fields. */
const ENTRY_BYTES = 64;
/** Nesting below this depth is counted as one opaque object. */
const MAX_DEPTH = 32;
/** Values visited per estimate; the rest of the value is not walked. */
const MAX_NODES = 100_000;

/**
 * Approximates the bytes retained by an untrusted value: about 2 bytes per
 * string character, {@link SCALAR_BYTES} per scalar, plus per-object and
 * per-key overheads. Never throws and never loops: cycles and shared objects
 * are counted once, and a property getter that throws counts as `undefined`.
 * The walk stops once the total exceeds `limit`, or when {@link MAX_DEPTH} or
 * {@link MAX_NODES} cuts it short, or when enumerating a value throws (an
 * `ownKeys` or `length` trap, a revoked proxy): it then fails closed, so the
 * result is above `limit`, not exact, and a value too deep, too wide or
 * impossible to enumerate counts as oversized. Never uses `JSON.stringify`.
 */
export function estimateBytes(value: unknown, limit: number): number {
  const visited = new WeakSet<object>();
  let nodes = 0;
  let total = 0;
  // Whether a cap cut the walk short, leaving part of the value unweighed.
  let truncated = false;

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
    if (visited.has(current)) return;
    if (depth >= MAX_DEPTH) {
      truncated = true;
      return;
    }
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
      // A proxy trap threw while enumerating (ownKeys, length, a revoked
      // proxy): the rest of the value is unweighed, so fail closed.
      truncated = true;
    }
  };
  // Called before each child: a child left unwalked by the node cap truncates.
  const exhausted = (): boolean => {
    if (nodes >= MAX_NODES) truncated = true;
    return truncated || total > limit;
  };

  walk(value, 0);
  return truncated ? Math.max(total, limit + 1) : total;
}

/** Fields {@link coreWeight} does not walk: a constant, the id, the metadata. */
const UNWALKED_FIELDS: ReadonlySet<string> = new Set(["kind", "id", "metadata"]);

/**
 * Weight of the parts of an entry an update never changes: a constant and
 * the id, plus every other field but the metadata (the record of a trace,
 * the raw frame and reason of an unparsed entry, the reason of a gap, and
 * the optional fields present). The store weighs the copy it keeps, which
 * holds the contract fields of the entry's kind only. Computed once when the
 * entry is added.
 */
export function coreWeight(entry: ViewerEntry, limit: number): number {
  let total = ENTRY_BYTES + entry.id.length * 2;
  for (const key of Object.keys(entry)) {
    if (total > limit) break;
    if (UNWALKED_FIELDS.has(key)) continue;
    total += estimateBytes((entry as unknown as Record<string, unknown>)[key], limit);
  }
  return total;
}

/**
 * Weight of an entry's metadata, recomputed when an update changes it. Like
 * any estimate it fails closed, so metadata grown past the walk's caps by
 * repeated updates weighs more than `limit` and the bounds evict.
 */
export function metadataWeight(entry: ViewerEntry, limit: number): number {
  return entry.metadata === undefined ? 0 : estimateBytes(entry.metadata, limit);
}
