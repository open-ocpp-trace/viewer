import type { Unsubscribe } from "./adapter.ts";
import type { CorrelationChange, Correlator } from "./correlation.ts";
import type { EntryId, ViewerEntry } from "./entry.ts";
import type { FilterFieldDefinition } from "./extension.ts";
import { matchesFilter, type MatchContext } from "./filter-match.ts";
import { compileFilter, fieldMap, type CompiledFilter, type TraceFilter } from "./filter-model.ts";
import {
  createStatsCounter,
  type EntryValues,
  extractValues,
  sameValues,
  type StatsCounter,
  type TraceStats,
} from "./filter-stats.ts";
import type { ViewerStore, ViewerStoreChange } from "./store.ts";
import { createListeners } from "./store-listeners.ts";

/** Options of {@link createFilterEngine}. */
export interface FilterEngineOptions {
  /**
   * Producer fields a filter can name; ids must be distinct. The engine
   * reads `values` when an entry is listed or updated, and keeps the result:
   * it must depend on the entry only.
   */
  readonly fields?: readonly FilterFieldDefinition[];
  /**
   * Source of derived actions. The engine only reads and follows it: the
   * host connects it to the same store.
   */
  readonly correlator?: Correlator;
  /**
   * Allows filters with `searchPayloads: true`. Off by default, as payloads
   * and raw frames may hold secrets.
   */
  readonly payloadSearch?: boolean;
}

/** One notification of a {@link FilterEngine}: the listed entries or the counts changed. */
export interface FilterChange {
  /** Equals {@link FilterEngine.version} after the change. */
  readonly version: number;
}

/**
 * The counts of a {@link FilterEngine} (see {@link TraceStats}). Pending
 * (paused) entries are in neither; the store's own stats count them.
 */
export interface FilterEngineStats {
  /**
   * Every listed entry of the store, whatever the filter: the source of
   * filter option lists, so a selected value never vanishes from them.
   */
  readonly buffer: TraceStats;
  /** The entries matching the current filter. */
  readonly filtered: TraceStats;
}

/**
 * The entries of one {@link ViewerStore} matching a {@link TraceFilter}, in
 * store list order, and their counts. Pending (paused) entries are not
 * listed; they join on resume through the store change. Records are never
 * mutated.
 *
 * The engine keeps the counted values and the membership of each listed
 * entry, so a store change costs O(added + evicted + updated) extractions,
 * plus an O(n) array move when membership changes in the middle of the
 * list; `setFilter` re-evaluates every listed entry.
 */
export interface FilterEngine {
  /**
   * Lists the matching entries of `store` (notifying if the store lists
   * any), then follows the store and the correlator, at most one
   * {@link FilterChange} per change of either. One store at a time: a
   * second connect throws. If reading the store throws while seeding,
   * connect rethrows and stays disconnected; if subscribing to the store or
   * the correlator throws, connect also releases the seed (notifying if the
   * store listed anything) before rethrowing. The returned
   * {@link Unsubscribe} stops following, empties the list and the counts
   * (notifying if anything was counted) and allows a new connect.
   */
  connect(store: ViewerStore): Unsubscribe;
  /** The current filter: a frozen copy of the last one set. Initially `{}`. */
  readonly filter: TraceFilter;
  /**
   * Validates and applies `filter`, notifying if the listed entries
   * changed. A malformed filter throws a `RangeError` and changes nothing.
   */
  setFilter(filter: TraceFilter): void;
  /** `setFilter({})`. */
  reset(): void;
  /** Number of listed entries. */
  readonly size: number;
  /**
   * The listed entry at `index`, 0 being the oldest; a negative, fractional
   * or out-of-range index returns `undefined`.
   */
  at(index: number): ViewerEntry | undefined;
  /** The listed index of `id`, or -1. */
  indexOf(id: EntryId): number;
  /** Whether `entry` matches the current filter, actions derived by the correlator. */
  matches(entry: ViewerEntry): boolean;
  /**
   * The counts of the store's listed entries and of the matching ones. The
   * same object until {@link FilterEngine.version} changes. The counts of
   * one value given the other properties of the filter (facet counts) are
   * not computed.
   */
  getStats(): FilterEngineStats;
  /**
   * Bumps once per notified {@link FilterChange}: when the listed entries
   * or the counts change, even if membership does not (a delivery update
   * on an entry the filter hides). Starts at 0.
   */
  readonly version: number;
  /**
   * Listeners run in subscription order. A throwing listener does not stop
   * the others; the first error is reported asynchronously (as a rejected
   * promise nobody handles), never thrown into the store, the correlator,
   * `connect` or `setFilter`, as with {@link Correlator.subscribe}. An
   * internal error while following the store is reported likewise, the list
   * left as it was; the next store change then lists the store anew.
   * Listeners should not throw.
   */
  subscribe(listener: (change: FilterChange) => void): Unsubscribe;
}

/** What the engine keeps about a listed entry. */
interface Cached {
  /** The current entry object, replaced on update. */
  readonly entry: ViewerEntry;
  /** Store list order: increases with every listed entry. */
  readonly seq: number;
  readonly values: EntryValues;
  readonly matches: boolean;
}

/** Number of entries a connected engine holds; a test hook, not exported from the package. */
const holdings = new WeakMap<FilterEngine, () => number>();

/** Entries `engine` holds: equals the store's `size` while connected. */
export function cachedSize(engine: FilterEngine): number {
  return holdings.get(engine)?.() ?? 0;
}

function sameIds(a: readonly EntryId[], b: readonly EntryId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * {@link createFilterEngine} with the function that receives listener and
 * internal errors. Not exported from the package.
 */
export function createFilterEngineWith(
  options: FilterEngineOptions | undefined,
  report: (error: unknown) => void,
): FilterEngine {
  const fields = fieldMap(options?.fields);
  const fieldIds = [...fields.keys()];
  const correlator = options?.correlator;
  const payloadSearch = options?.payloadSearch === true;
  const ctx: MatchContext = { fields, ...(correlator !== undefined && { correlator }) };
  const listeners = createListeners<FilterChange>();
  let compiled: CompiledFilter = compileFilter({}, fields, payloadSearch);
  /** Listed entries of the store, in store list order. */
  let cache = new Map<EntryId, Cached>();
  /** Matching ids, in store list order. */
  let ids: EntryId[] = [];
  let buffer: StatsCounter = createStatsCounter(fieldIds);
  let filtered: StatsCounter = createStatsCounter(fieldIds);
  let stats: FilterEngineStats | undefined;
  let seq = 0;
  let version = 0;
  let source: ViewerStore | undefined;
  let connected: object | undefined;
  /** A change was missed: the next one lists the store anew. */
  let stale = false;

  function empty(): void {
    cache = new Map();
    ids = [];
    buffer = createStatsCounter(fieldIds);
    filtered = createStatsCounter(fieldIds);
    stale = false;
  }

  function append(entry: ViewerEntry): void {
    const values = extractValues(entry, ctx);
    const matches = matchesFilter(entry, compiled, ctx);
    seq += 1;
    cache.set(entry.id, { entry, seq, values, matches });
    buffer.add(values);
    if (matches) {
      filtered.add(values);
      ids.push(entry.id);
    }
  }

  /** The index in `ids` of the first id at or after `target` in store order. */
  function position(target: number): number {
    let low = 0;
    let high = ids.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (cache.get(ids[middle]!)!.seq < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  /** Re-reads a cached entry (its new object, or a new derived action); whether anything changed. */
  function revise(entry: ViewerEntry): boolean {
    const old = cache.get(entry.id);
    if (old === undefined) return false;
    const values = extractValues(entry, ctx);
    const matches = matchesFilter(entry, compiled, ctx);
    const same = sameValues(old.values, values);
    cache.set(entry.id, { entry, seq: old.seq, values, matches });
    if (!same) {
      buffer.remove(old.values);
      buffer.add(values);
    }
    if (old.matches && (!matches || !same)) filtered.remove(old.values);
    if (matches && (!old.matches || !same)) filtered.add(values);
    if (matches !== old.matches) {
      const at = position(old.seq);
      // O(n) array move, accepted for membership changes in the middle.
      if (matches) ids.splice(at, 0, entry.id);
      else ids.splice(at, 1);
    }
    return !same || matches !== old.matches;
  }

  /** Lists the store anew; whether anything was or is now held. */
  function rebuild(store: ViewerStore): boolean {
    const entries = store.toArray();
    const had = cache.size > 0;
    empty();
    for (const entry of entries) append(entry);
    return had || cache.size > 0;
  }

  /** Applies one store change; whether the list or the counts changed. */
  function follow(store: ViewerStore, change: ViewerStoreChange): boolean {
    if (stale) return rebuild(store);
    // Read everything first, so a failing store leaves the state untouched.
    const read = (id: EntryId): ViewerEntry => {
      const entry = store.get(id);
      if (entry === undefined) throw new Error(`the store does not hold the listed entry ${id}`);
      return entry;
    };
    const updated = change.updated.filter((id) => cache.has(id)).map(read);
    const added = change.added.map(read);

    let changed = false;
    if (change.cleared && cache.size > 0) {
      empty();
      changed = true;
    }
    let dropped = 0;
    for (const id of change.evicted) {
      const old = cache.get(id);
      if (old === undefined) continue;
      cache.delete(id);
      buffer.remove(old.values);
      if (old.matches) {
        filtered.remove(old.values);
        dropped += 1;
      }
      changed = true;
    }
    // The evicted entries are the oldest, so their ids lead the list.
    if (dropped > 0) ids.splice(0, dropped);
    for (const entry of updated) if (revise(entry)) changed = true;
    for (const entry of added) append(entry);
    return changed || added.length > 0;
  }

  /** Re-reads the derived actions of the entries a correlator change names. */
  function correlate(change: CorrelationChange): boolean {
    if (stale) return false;
    let changed = false;
    const entries = change.cleared
      ? [...cache.values()].map((cached) => cached.entry)
      : change.changed.flatMap((id) => cache.get(id)?.entry ?? []);
    for (const entry of entries) if (revise(entry)) changed = true;
    return changed;
  }

  function emit(): void {
    version += 1;
    stats = undefined;
    try {
      listeners.emit({ version });
    } catch (error) {
      report(error);
    }
  }

  /** Runs `step`, notifying if it changed anything; an error is reported and marks the state stale. */
  function guard(step: () => boolean): void {
    let changed: boolean;
    try {
      changed = step();
    } catch (error) {
      stale = true;
      report(error);
      return;
    }
    if (changed) emit();
  }

  /** Empties the list and the counts, notifying if anything was held. */
  function release(): void {
    const had = cache.size > 0;
    empty();
    source = undefined;
    if (had) emit();
  }

  const engine: FilterEngine = {
    connect(store) {
      if (connected !== undefined) throw new Error("the filter engine is already connected");
      const connection = {};
      try {
        rebuild(store);
      } catch (error) {
        empty();
        throw error;
      }
      connected = connection;
      source = store;
      if (cache.size > 0) emit();

      const onStore = (change: ViewerStoreChange): void => {
        if (connected === connection) guard(() => follow(store, change));
      };
      const onCorrelator = (change: CorrelationChange): void => {
        if (connected === connection) guard(() => correlate(change));
      };

      const subscriptions: Unsubscribe[] = [];
      try {
        subscriptions.push(store.subscribe(onStore));
        if (correlator !== undefined) subscriptions.push(correlator.subscribe(onCorrelator));
      } catch (error) {
        for (const unsubscribe of subscriptions) unsubscribe();
        connected = undefined;
        release();
        throw error;
      }
      return () => {
        if (connected !== connection) return;
        connected = undefined;
        for (const unsubscribe of subscriptions) unsubscribe();
        release();
      };
    },
    get filter() {
      return compiled.filter;
    },
    setFilter(filter) {
      compiled = compileFilter(filter, fields, payloadSearch);
      const store = source;
      if (store === undefined) return;
      guard(() => {
        if (stale) return rebuild(store);
        // The only full pass: membership and the filtered counts; the buffer is untouched.
        const before = ids;
        ids = [];
        filtered = createStatsCounter(fieldIds);
        for (const [id, cached] of cache) {
          const matches = matchesFilter(cached.entry, compiled, ctx);
          if (matches !== cached.matches) cache.set(id, { ...cached, matches });
          if (!matches) continue;
          filtered.add(cached.values);
          ids.push(id);
        }
        return !sameIds(before, ids);
      });
    },
    reset() {
      engine.setFilter({});
    },
    get size() {
      return ids.length;
    },
    at(index) {
      const id = Number.isInteger(index) ? ids[index] : undefined;
      return id === undefined ? undefined : cache.get(id)?.entry;
    },
    indexOf(id) {
      const cached = cache.get(id);
      return cached?.matches === true ? position(cached.seq) : -1;
    },
    matches(entry) {
      return matchesFilter(entry, compiled, ctx);
    },
    getStats() {
      stats ??= Object.freeze({ buffer: buffer.snapshot(), filtered: filtered.snapshot() });
      return stats;
    },
    get version() {
      return version;
    },
    subscribe(listener) {
      return listeners.subscribe(listener);
    },
  };
  holdings.set(engine, () => cache.size);
  return engine;
}

/** Creates a {@link FilterEngine} listing every entry until a filter is set. */
export function createFilterEngine(options?: FilterEngineOptions): FilterEngine {
  return createFilterEngineWith(options, (error) => {
    void Promise.reject(error);
  });
}
