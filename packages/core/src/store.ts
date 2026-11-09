import type { EntryId, ViewerEntry } from "./entry.ts";
import { coreWeight, metadataWeight } from "./store-estimate.ts";
import { checkItem, normalizeAddedEntry } from "./store-ingest.ts";
import type { EntryUpdate } from "./update.ts";

/** Default {@link ViewerStoreOptions.maxEntries}. */
export const DEFAULT_MAX_ENTRIES = 10_000;

/** Default {@link ViewerStoreOptions.maxBytes}: 64 MiB. */
export const DEFAULT_MAX_BYTES: number = 64 * 1024 * 1024;

/**
 * Prefix of the ids the store gives its own entries (such as the gap it lists
 * when entries were dropped). An adapter must not use it.
 */
export const STORE_ID_PREFIX = "viewer-store:";

/**
 * Bounds of a viewer store. Each limit is an integer >= 1; any other value
 * (non-finite, below 1, not an integer) throws a `RangeError` from
 * {@link createViewerStore}, as it is a programmer error, not trace data.
 */
export interface ViewerStoreOptions {
  /** Maximum number of listed entries. Default {@link DEFAULT_MAX_ENTRIES}. */
  readonly maxEntries?: number;
  /**
   * Maximum approximate bytes retained by the listed entries. Default
   * {@link DEFAULT_MAX_BYTES}.
   *
   * An entry weighs its record (trace), raw frame and reason (unparsed) or a
   * constant (gap), estimated once when it is added, plus its metadata. The
   * estimate is approximate (about 2 bytes per string character) and never
   * reads more than it needs to exceed this limit.
   *
   * After each add, the oldest listed entries are evicted while the list
   * holds more than `maxEntries` entries or more than `maxBytes` bytes with
   * more than one entry. An entry heavier than `maxBytes` on its own is
   * therefore kept alone: it evicts every older entry and stays the only
   * listed entry until the next add evicts it.
   */
  readonly maxBytes?: number;
}

/** Counters of a viewer store. */
export interface ViewerStoreStats {
  /** Listed entries, equal to {@link ViewerStore.size}. */
  readonly listed: number;
  /** Approximate bytes retained by the listed entries. */
  readonly listedBytes: number;
  readonly pending: number;
  readonly pendingBytes: number;
  readonly paused: boolean;
  /** Listed entries removed by the bounds, cumulative. */
  readonly evicted: number;
  /** Pending entries removed by the bounds while paused, cumulative. */
  readonly droppedPending: number;
  /** Duplicate adds ignored (rule 6). */
  readonly duplicates: number;
  /** Updates for an id the store does not hold (rule 2). */
  readonly unknownUpdates: number;
  /** Updates ignored for a stale revision (rule 1). */
  readonly staleUpdates: number;
  /**
   * Batch items dropped as invalid: not an object, an unknown `type`, an
   * `add` whose entry is not an object or has an unknown `kind` or a
   * non-string `id`, an `update` with a non-string `id` or a `metadata` that
   * is not a plain object.
   */
  readonly invalid: number;
}

/**
 * Holds the viewer's entries in arrival order, within the configured bounds.
 * It never mutates an entry or its record.
 */
export interface ViewerStore {
  /**
   * Applies one batch of untrusted updates, in array order. Invalid items are
   * dropped and counted in {@link ViewerStoreStats.invalid}; the rest of the
   * batch still applies. An `add` for an id already held is ignored and
   * counted (rule 6); an `add` for an evicted id is a new entry.
   */
  apply(batch: readonly EntryUpdate[]): void;
  /** Applies a snapshot: each entry as an `add`, in one batch. */
  load(entries: readonly ViewerEntry[]): void;
  /** Number of listed entries. */
  readonly size: number;
  /**
   * The listed entry at `index`, 0 being the oldest, in O(1). Unlike
   * `Array.prototype.at`, a negative, fractional or out-of-range index
   * returns `undefined`.
   */
  at(index: number): ViewerEntry | undefined;
  /** The listed index of `id` in O(1), or -1 when it is not listed. */
  indexOf(id: EntryId): number;
  /** The entry held under `id`, or `undefined`. */
  get(id: EntryId): ViewerEntry | undefined;
  /** A copy of the listed entries, oldest first, in O(n). */
  toArray(): readonly ViewerEntry[];
  /** The current counters. */
  getStats(): ViewerStoreStats;
}

interface Slot {
  readonly entry: ViewerEntry;
  /** Position in the listing sequence; the listed index is `seq - headSeq`. */
  readonly seq: number;
  /** Cached weight of the record or raw frame, computed once at add. */
  readonly coreBytes: number;
  /** Cached weight of the metadata, recomputed when it changes. */
  readonly metadataBytes: number;
}

/** The backing array is compacted once this many evicted slots precede the head. */
const COMPACT_THRESHOLD = 1024;

interface StoreInternals {
  indexSize(): number;
  backingLength(): number;
}

const internals = new WeakMap<ViewerStore, StoreInternals>();

/** Test hook: internal sizes of a store. Not exported from the package. */
export function storeInternals(store: ViewerStore): StoreInternals {
  const found = internals.get(store);
  if (found === undefined) throw new TypeError("not a viewer store");
  return found;
}

function checkLimit(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be an integer >= 1, got ${String(value)}`);
  }
  return value;
}

/** Creates an empty viewer store. */
export function createViewerStore(options: ViewerStoreOptions = {}): ViewerStore {
  const maxEntries = checkLimit("maxEntries", options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxBytes = checkLimit("maxBytes", options.maxBytes, DEFAULT_MAX_BYTES);

  const index = new Map<EntryId, Slot>();
  // Listed slots live at listed[head..]; evicted ones are cleared, and the
  // array is compacted occasionally instead of shifted per eviction.
  let listed: (Slot | undefined)[] = [];
  let head = 0;
  let headSeq = 0;
  let nextSeq = 0;
  let listedBytes = 0;
  const counters = { evicted: 0, duplicates: 0, unknownUpdates: 0, invalid: 0 };

  const slotAt = (position: number): Slot | undefined => listed[head + position];
  const listedCount = (): number => listed.length - head;

  const evictOldest = (): void => {
    const slot = listed[head];
    if (slot === undefined) return;
    listed[head] = undefined;
    head++;
    headSeq++;
    index.delete(slot.entry.id);
    listedBytes -= slot.coreBytes + slot.metadataBytes;
    counters.evicted++;
    if (head >= COMPACT_THRESHOLD && head * 2 >= listed.length) {
      listed = listed.slice(head);
      head = 0;
    }
  };

  const enforceBounds = (): void => {
    while (listedCount() > maxEntries || (listedBytes > maxBytes && listedCount() > 1)) {
      evictOldest();
    }
  };

  const append = (added: ViewerEntry): void => {
    const entry = normalizeAddedEntry(added);
    const slot: Slot = {
      entry,
      seq: nextSeq++,
      coreBytes: coreWeight(entry, maxBytes),
      metadataBytes: metadataWeight(entry, maxBytes),
    };
    index.set(entry.id, slot);
    listed.push(slot);
    listedBytes += slot.coreBytes + slot.metadataBytes;
    enforceBounds();
  };

  const ingest = (item: unknown): void => {
    const checked = checkItem(item);
    if (checked === undefined) {
      counters.invalid++;
    } else if (checked.type === "add") {
      if (index.has(checked.entry.id)) counters.duplicates++;
      else append(checked.entry);
    } else if (!index.has(checked.id)) {
      counters.unknownUpdates++;
    }
  };

  const store: ViewerStore = {
    apply(batch) {
      for (const item of batch) ingest(item);
    },
    load(entries) {
      for (const entry of entries) ingest({ type: "add", entry });
    },
    get size() {
      return listedCount();
    },
    at(position) {
      if (!Number.isInteger(position) || position < 0) return undefined;
      return slotAt(position)?.entry;
    },
    indexOf(id) {
      const slot = index.get(id);
      return slot === undefined ? -1 : slot.seq - headSeq;
    },
    get(id) {
      return index.get(id)?.entry;
    },
    toArray() {
      const entries: ViewerEntry[] = [];
      for (let position = head; position < listed.length; position++) {
        const slot = listed[position];
        if (slot !== undefined) entries.push(slot.entry);
      }
      return entries;
    },
    getStats() {
      return {
        listed: listedCount(),
        listedBytes,
        pending: 0,
        pendingBytes: 0,
        paused: false,
        droppedPending: 0,
        staleUpdates: 0,
        ...counters,
      };
    },
  };
  internals.set(store, { indexSize: () => index.size, backingLength: () => listed.length });
  return store;
}
