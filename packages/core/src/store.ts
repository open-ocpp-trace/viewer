import type { Unsubscribe, ViewerAdapter } from "./adapter.ts";
import { connectAdapter } from "./store-connect.ts";
import type { EntryId, GapEntry, ViewerEntry } from "./entry.ts";
import { coreWeight, metadataWeight } from "./store-estimate.ts";
import { checkItem, mergeMetadata, normalizeAddedEntry, STORE_ID_PREFIX } from "./store-ingest.ts";
import { reportViewerError, type ViewerErrorHandler } from "./report-error.ts";
import { createListeners, firstError, type FirstError } from "./store-listeners.ts";
import { createSlotQueue, type Slot } from "./store-queue.ts";
import type { EntryMetadataPatch, EntryUpdate } from "./update.ts";

/** Default {@link ViewerStoreOptions.maxEntries}. */
export const DEFAULT_MAX_ENTRIES = 10_000;

/** Default {@link ViewerStoreOptions.maxBytes}: 64 MiB. */
export const DEFAULT_MAX_BYTES: number = 64 * 1024 * 1024;

export { STORE_ID_PREFIX };

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
   * An entry weighs a constant, its id and its other contract fields (the
   * record of a trace, the raw frame and reason of an unparsed entry, the
   * reason of a gap, and the optional fields present), estimated once when
   * it is added, plus its metadata, re-estimated on each update. The store
   * keeps a copy holding only the contract fields of the entry's kind, so
   * nothing it does not weigh is retained. The estimate is approximate
   * (about 2 bytes per string character) and never reads more than it needs
   * to exceed this limit. It fails closed: a value nested too deep or too
   * wide to be walked counts as heavier than this limit, so it is oversized.
   *
   * After each add, the oldest listed entries are evicted while the list
   * holds more than `maxEntries` entries or more than `maxBytes` bytes with
   * more than one entry. An entry heavier than `maxBytes` on its own is
   * therefore kept alone: it evicts every older entry and stays the only
   * listed entry until the next add evicts it.
   */
  readonly maxBytes?: number;
  /**
   * Receives the errors no caller is left to receive, synchronously: each
   * listener error (`{ component: "store", callback: "listener" }`) and an
   * error raised while a promised snapshot settles (`callback:
   * "snapshot"`). Without it, they go to the default reporter of
   * {@link reportViewerError}: `globalThis.reportError`, else
   * `console.error`.
   */
  readonly onError?: ViewerErrorHandler;
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
   * `add` whose entry is not an object or has an unknown `kind`, a
   * non-string `id` or one starting with {@link STORE_ID_PREFIX}, an `update`
   * with a non-string `id`, a `metadata` that is not a plain object or a
   * `revision` that is not an integer >= 0 (an explicit `undefined` counts
   * as no revision), a `deliveries` (in an update's patch or an add's
   * metadata) that is neither an array, `null` nor `undefined`, and any item
   * whose reading throws (a hostile getter or proxy trap), which is then
   * applied not at all.
   */
  readonly invalid: number;
}

/**
 * Holds the viewer's entries in arrival order, within the configured bounds.
 * It keeps a shallow copy of each added entry, limited to the contract fields
 * of its kind and sharing its record, and never mutates an entry or its
 * record.
 *
 * Changes are serialized. A call to {@link apply}, {@link load},
 * {@link pause}, {@link resume} or {@link clear} made while a change runs or
 * notifies (from a listener, or from a getter of a batch item) is queued and
 * returns before it has applied: it runs after the current change has
 * notified, in call order, as its own change with its own notification. Its
 * effects, its no-op checks and its reading of the batch happen when it runs.
 * An error its own body raises (a throwing batch iterator) is rethrown from
 * the outermost call, after the queue has run, unless that call already has
 * one. Listener errors are never rethrown: each one goes to
 * {@link ViewerStoreOptions.onError}.
 */
export interface ViewerStore {
  /**
   * Applies one batch of untrusted updates, in array order. Invalid items are
   * dropped and counted in {@link ViewerStoreStats.invalid}; the rest of the
   * batch still applies. Each item is read once and applies whole or not at
   * all. An `add` for an id already held is ignored and counted (rule 6); an
   * `add` for an evicted id is a new entry. If iterating the batch itself
   * throws, what was applied before is kept and notified, then the error is
   * rethrown. A nested call is queued and returns before it has applied (see
   * {@link ViewerStore}).
   */
  apply(batch: readonly EntryUpdate[]): void;
  /**
   * Applies a snapshot: each entry as an `add`, in one batch. A nested call is
   * queued and returns before it has applied (see {@link ViewerStore}).
   */
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
  /** Bumped once per notified change; starts at 0. */
  readonly version: number;
  /** The current counters: the same object until {@link version} changes. */
  getStats(): ViewerStoreStats;
  /**
   * Calls `listener` after each change, once the store is consistent.
   * Listeners run in subscription order; one subscribed during a
   * notification is first called on the next change, one unsubscribed during
   * it is not called anymore. A throwing listener does not stop the others,
   * and its error is not rethrown to the call that made the change: it goes
   * to {@link ViewerStoreOptions.onError} (`callback: "listener"`), the change
   * already applied. Each call returns its own idempotent
   * {@link Unsubscribe}, even for the same function.
   */
  subscribe(listener: (change: ViewerStoreChange) => void): Unsubscribe;
  /**
   * Stops listing new entries: adds go to a pending queue (oldest first),
   * while updates keep applying to listed and pending entries, and a pending
   * id counts as held for rules 2 and 6. The queue has its own budget: the
   * configured limits minus room for the gap {@link resume} may list (one
   * entry and its weight), so the store retains at most twice the limits.
   * An oversized entry is kept alone as in the list. Past the budget, the
   * oldest pending entries are dropped and counted in
   * {@link ViewerStoreStats.droppedPending}. A dropped entry is gone: a later
   * update for it is unknown, a later add for it is a new entry. No effect
   * when already paused. A nested call is queued and returns before it has
   * applied (see {@link ViewerStore}).
   */
  pause(): void;
  /**
   * Lists the pending entries in arrival order, after a store gap
   * (`reason: "dropped"`, id {@link STORE_ID_PREFIX}`gap:<n>`, `missedCount`
   * the entries dropped during this pause) when some were dropped; the list
   * bounds then apply as for any add. As the pending budget kept room for
   * it, the gap and the survivors fit and only older entries are evicted,
   * except when no room can be kept: with `maxEntries` 1, or when the
   * survivor is oversized, the survivor evicts the gap in the same change.
   * One notification. No effect when not paused. A nested call is queued and
   * returns before it has applied (see {@link ViewerStore}).
   */
  resume(): void;
  /** Whether adds currently go to the pending queue. */
  readonly paused: boolean;
  /** Whether `id` is held in the pending queue. */
  isPending(id: EntryId): boolean;
  /**
   * Removes every listed and pending entry and resets every counter to 0,
   * keeping {@link paused} and the gap numbering. Notifies `cleared: true`
   * with no `evicted`. Afterwards an update for an old id is unknown and an
   * add for it is a new entry. A nested call is queued and returns before it
   * has applied (see {@link ViewerStore}).
   */
  clear(): void;
  /**
   * Feeds the store from `adapter`: subscribes first and buffers the batches
   * received, applies the snapshot as {@link load} (before returning when it
   * is synchronous, when it resolves otherwise), replays the buffer in order,
   * then applies each batch as it arrives. A snapshot that rejects or is not
   * an array lists a store gap (`reason: "unknown"`, id
   * {@link STORE_ID_PREFIX}`gap:<n>` shared with {@link resume}) before the
   * replay. Reconnecting is a new `connect`: its overlap with what is held
   * counts as duplicates (rule 6). If `subscribe` or `snapshot` throws, what
   * was subscribed is unsubscribed and the error rethrown. A snapshot that is
   * a thenable is resolved as a promise: it takes effect once, however often
   * it calls back, and a `then` that throws counts as a rejection. The
   * returned {@link Unsubscribe} is idempotent and stops everything, a
   * pending snapshot included: nothing from it is applied, and its rejection
   * is still handled.
   *
   * While the snapshot is pending, the buffer holds at most `maxEntries - 1`
   * items (at least 1), adds and updates alike: past it, the oldest batches
   * are dropped whole, the newest one always kept. If any was dropped, a
   * store gap (`reason: "dropped"`, id {@link STORE_ID_PREFIX}`gap:<n>`,
   * `missedCount` the `add` items dropped) is listed after the snapshot and
   * before the replay, even when only updates were dropped.
   *
   * A listener error while a connection settles is reported as for any
   * change and stops nothing. If reading the snapshot or a buffered batch
   * throws, the snapshot, gap and replay still apply as far as they can be
   * read. For a synchronous snapshot, the connection is then unsubscribed
   * and the first error rethrown, the store keeping what it applied; for a
   * promised one, the error goes to {@link ViewerStoreOptions.onError}
   * (`callback: "snapshot"`) and the connection keeps forwarding.
   *
   * Called while a change runs or notifies, the synchronous snapshot, gap
   * and replay are queued as nested calls (see {@link ViewerStore}): they
   * apply after `connect` returns, their listener errors are reported, and
   * an error reading them is rethrown from the outermost call.
   */
  connect(adapter: ViewerAdapter): Unsubscribe;
}

/**
 * The net effect of one batch on the listed entries.
 *
 * A consumer applies it to its previous copy of the list: drop everything
 * if `cleared`, then drop `evicted.length` entries from the front, then
 * append `added`. An id added and evicted within the same batch is in
 * neither list, though it counts in {@link ViewerStoreStats.evicted}. A
 * change with no listed delta is still notified when the counters changed,
 * so they can be rendered again; a batch that changes nothing is not
 * notified and does not bump the version.
 */
export interface ViewerStoreChange {
  /** Equals {@link ViewerStore.version} after the change. */
  readonly version: number;
  /** Newly listed ids, in list order, appended at the end. */
  readonly added: readonly EntryId[];
  /** Listed ids whose metadata changed, excluding `added` and `evicted`. */
  readonly updated: readonly EntryId[];
  /** Ids removed from the front of the list, oldest first. */
  readonly evicted: readonly EntryId[];
  /** Everything listed before the change is gone. */
  readonly cleared: boolean;
}

interface StoreInternals {
  indexSize(): number;
  backingLength(): number;
  pendingBackingLength(): number;
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

function zeroCounters() {
  return {
    evicted: 0,
    droppedPending: 0,
    duplicates: 0,
    unknownUpdates: 0,
    staleUpdates: 0,
    invalid: 0,
  };
}

/** Creates an empty viewer store. */
export function createViewerStore(options: ViewerStoreOptions = {}): ViewerStore {
  const maxEntries = checkLimit("maxEntries", options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxBytes = checkLimit("maxBytes", options.maxBytes, DEFAULT_MAX_BYTES);

  // Listed and pending slots, both indexed by id.
  const index = new Map<EntryId, Slot>();
  const listed = createSlotQueue();
  const pending = createSlotQueue();
  // Sequence of the oldest listed slot, and of the next slot to list.
  let headSeq = 0;
  let nextSeq = 0;
  let paused = false;
  let droppedThisPause = 0;
  let gaps = 0;
  // The pending budget keeps room for the next store gap (one entry and its
  // weight) so that, on resume, the gap and the survivors fit the list.
  const nextGap = (reason: string): GapEntry => ({
    kind: "gap",
    id: `${STORE_ID_PREFIX}gap:${gaps + 1}`,
    reason,
  });
  // The weight of the gap resume lists: a number weighs the same at any value.
  const pendingBytesBudget = (): number =>
    maxBytes - coreWeight({ ...nextGap("dropped"), missedCount: 0 }, maxBytes);
  const maxPending = Math.max(1, maxEntries - 1);
  let maxPendingBytes = pendingBytesBudget();
  let counters = zeroCounters();
  const onError = options.onError;
  const listeners = createListeners<ViewerStoreChange>((error) =>
    reportViewerError(onError, error, { component: "store", callback: "listener" }),
  );
  let version = 0;
  let stats: ViewerStoreStats | undefined;
  // State of the change being made: whether anything changed, whether the
  // list was cleared, the first sequence it lists, the ids listed before it
  // that it evicted, and the ids it updated.
  let changed = false;
  let cleared = false;
  let batchSeq = 0;
  let batchEvicted: EntryId[] = [];
  const batchUpdated = new Set<EntryId>();

  const enforceBounds = (): void => {
    while (listed.overLimits(maxEntries, maxBytes)) {
      const slot = listed.shift() as Slot;
      headSeq++;
      index.delete(slot.id);
      counters.evicted++;
      if (slot.seq < batchSeq) batchEvicted.push(slot.id);
    }
    while (pending.overLimits(maxPending, maxPendingBytes)) {
      index.delete((pending.shift() as Slot).id);
      counters.droppedPending++;
      droppedThisPause++;
    }
  };

  const list = (slot: Slot): void => {
    slot.seq = nextSeq++;
    listed.push(slot);
    enforceBounds();
  };

  /**
   * Holds a new entry, built by the store from checked values: listed, or
   * pending while paused. Weighing never throws, so nothing here can fail
   * half-way.
   */
  const admit = (entry: ViewerEntry): void => {
    const slot: Slot = {
      id: entry.id,
      entry,
      seq: -1,
      coreBytes: coreWeight(entry, maxBytes),
      metadataBytes: metadataWeight(entry, maxBytes),
      revision: undefined,
    };
    index.set(slot.id, slot);
    if (!paused) return list(slot);
    pending.push(slot);
    enforceBounds();
  };

  /** Holds a store gap under the next gap number. */
  const admitGap = (gap: GapEntry): void => {
    gaps++;
    maxPendingBytes = pendingBytesBudget();
    admit(gap);
  };

  /**
   * Applies rules 1 and 5 to a held entry, re-weighing its metadata only and
   * enforcing the bounds at once. Returns whether anything changed. Every
   * untrusted read (the merge) happens before the first mutation, and the
   * watermark is written last, so a throw leaves the entry as it was.
   */
  const applyUpdate = (
    slot: Slot,
    patch: EntryMetadataPatch,
    revision: number | undefined,
  ): boolean => {
    if (revision !== undefined && slot.revision !== undefined && revision <= slot.revision) {
      counters.staleUpdates++;
      return true;
    }
    const metadata = mergeMetadata(slot.entry.metadata, patch);
    if (metadata !== undefined) {
      const entry = { ...slot.entry, metadata } as ViewerEntry;
      const bytes = metadataWeight(entry, maxBytes);
      slot.entry = entry;
      (slot.seq < 0 ? pending : listed).reweigh(bytes - slot.metadataBytes);
      slot.metadataBytes = bytes;
      batchUpdated.add(slot.id);
    }
    if (revision !== undefined) slot.revision = revision;
    if (metadata === undefined) return false;
    enforceBounds();
    return true;
  };

  /**
   * Applies one untrusted item atomically: a throw while reading it (a
   * hostile getter or proxy trap) drops it as invalid, with nothing applied.
   */
  const ingest = (item: unknown): void => {
    try {
      const checked = checkItem(item);
      if (checked === undefined) {
        counters.invalid++;
      } else if (checked.type === "add") {
        if (index.has(checked.id)) {
          counters.duplicates++;
        } else {
          const entry = normalizeAddedEntry(checked);
          if (entry === undefined) counters.invalid++;
          else admit(entry);
        }
      } else {
        const slot = index.get(checked.id);
        if (slot === undefined) counters.unknownUpdates++;
        else if (!applyUpdate(slot, checked.metadata, checked.revision)) return;
      }
    } catch {
      counters.invalid++;
    }
    changed = true;
  };

  /**
   * Runs `body` as one change, then notifies its net delta, if anything
   * changed. When `body` throws (a throwing batch iterator), what it applied
   * is still notified and its error goes to `errors`. Notifying never
   * throws: listener errors are reported.
   */
  const runChange = (body: () => void, errors: FirstError): void => {
    changed = false;
    cleared = false;
    batchSeq = nextSeq;
    batchEvicted = [];
    batchUpdated.clear();
    errors.run(body);
    notify();
  };

  // Changes requested while another one runs or notifies, in call order.
  const queued: (() => void)[] = [];
  let running = false;

  /**
   * Runs `body` as one change. Changes are serialized: a call made while a
   * change runs or notifies (from a listener, or from a getter read by a
   * batch) is queued and returns at once; it runs after the current change
   * has notified, as its own change. The outermost call runs the queue to
   * the end, then rethrows the first error a body raised: its own change's,
   * else one from a queued change.
   */
  const transact = (body: () => void): void => {
    if (running) {
      queued.push(body);
      return;
    }
    running = true;
    const errors = firstError();
    try {
      runChange(body, errors);
      // Every queued change runs, even after an error.
      for (let next = queued.shift(); next !== undefined; next = queued.shift()) {
        runChange(next, errors);
      }
    } finally {
      running = false;
    }
    errors.rethrow();
  };

  /** Notifies the net delta of the current change, if anything changed. */
  const notify = (): void => {
    if (!changed) return;
    // Entries listed by this change and still listed: a suffix of the list.
    const added = listed.from(Math.max(headSeq, batchSeq) - headSeq).map((slot) => slot.id);
    // Updated ids still listed from before this change.
    const updated = [...batchUpdated].filter((id) => {
      const seq = index.get(id)?.seq ?? -1;
      return seq >= 0 && seq < batchSeq;
    });
    version++;
    stats = undefined;
    const change: ViewerStoreChange = Object.freeze({
      version,
      added: Object.freeze(added),
      updated: Object.freeze(updated),
      evicted: Object.freeze(batchEvicted),
      cleared,
    });
    listeners.emit(change);
  };

  const runBatch = (items: Iterable<unknown>): void => {
    transact(() => {
      for (const item of items) ingest(item);
    });
  };

  const store: ViewerStore = {
    apply(batch) {
      runBatch(batch);
    },
    load(entries) {
      transact(() => {
        for (const entry of entries) ingest({ type: "add", entry });
      });
    },
    get size() {
      return listed.length;
    },
    at(position) {
      if (!Number.isInteger(position) || position < 0) return undefined;
      return listed.at(position)?.entry;
    },
    indexOf(id) {
      const seq = index.get(id)?.seq ?? -1;
      return seq < 0 ? -1 : seq - headSeq;
    },
    get(id) {
      return index.get(id)?.entry;
    },
    toArray() {
      return listed.from(0).map((slot) => slot.entry);
    },
    get version() {
      return version;
    },
    getStats() {
      stats ??= Object.freeze({
        listed: listed.length,
        listedBytes: listed.bytes,
        pending: pending.length,
        pendingBytes: pending.bytes,
        paused,
        ...counters,
      });
      return stats;
    },
    subscribe(listener) {
      return listeners.subscribe(listener);
    },
    pause() {
      transact(() => {
        if (paused) return;
        paused = true;
        droppedThisPause = 0;
        changed = true;
      });
    },
    resume() {
      transact(() => {
        if (!paused) return;
        paused = false;
        changed = true;
        if (droppedThisPause > 0) {
          admitGap({ ...nextGap("dropped"), missedCount: droppedThisPause });
        }
        droppedThisPause = 0;
        for (const slot of pending.drain()) list(slot);
      });
    },
    get paused() {
      return paused;
    },
    isPending(id) {
      return index.get(id)?.seq === -1;
    },
    connect(adapter) {
      return connectAdapter(
        {
          maxBuffered: maxPending,
          apply: (batch) => store.apply(batch),
          load: (entries) => store.load(entries),
          snapshotFailed: () =>
            transact(() => {
              admitGap(nextGap("unknown"));
              changed = true;
            }),
          bufferDropped: (missedCount) =>
            transact(() => {
              admitGap({ ...nextGap("dropped"), missedCount });
              changed = true;
            }),
          reportSettleError: (error) =>
            reportViewerError(onError, error, { component: "store", callback: "snapshot" }),
        },
        adapter,
      );
    },
    clear() {
      transact(() => {
        index.clear();
        listed.drain();
        pending.drain();
        headSeq = nextSeq;
        droppedThisPause = 0;
        counters = zeroCounters();
        changed = true;
        cleared = true;
      });
    },
  };
  internals.set(store, {
    indexSize: () => index.size,
    backingLength: () => listed.backingLength,
    pendingBackingLength: () => pending.backingLength,
  });
  return store;
}
