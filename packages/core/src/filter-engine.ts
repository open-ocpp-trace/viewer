import type { Unsubscribe } from "./adapter.ts";
import type { CorrelationChange, Correlator } from "./correlation.ts";
import type { EntryId, ViewerEntry } from "./entry.ts";
import type { FilterFieldDefinition } from "./extension.ts";
import { matchesFilter, type MatchContext } from "./filter-match.ts";
import { compileFilter, type CompiledFilter, type TraceFilter } from "./filter-model.ts";
import type { ViewerStore, ViewerStoreChange } from "./store.ts";
import { createListeners } from "./store-listeners.ts";

/** Options of {@link createFilterEngine}. */
export interface FilterEngineOptions {
  /** Producer fields a filter can name; ids must be distinct. */
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

/** One notification of a {@link FilterEngine}: the listed entries changed. */
export interface FilterChange {
  /** Equals {@link FilterEngine.version} after the change. */
  readonly version: number;
}

/**
 * The entries of one {@link ViewerStore} matching a {@link TraceFilter}, in
 * store list order. Pending (paused) entries are not listed; they join on
 * resume through the store change. Records are never mutated.
 */
export interface FilterEngine {
  /**
   * Lists the matching entries of `store` (notifying if any), then follows
   * the store and the correlator, at most one {@link FilterChange} per
   * change of either. One store at a time: a second connect throws. If
   * reading the store throws while seeding, connect rethrows and stays
   * disconnected; if subscribing to the store or the correlator throws,
   * connect also releases the seed (notifying if anything was listed)
   * before rethrowing. The returned {@link Unsubscribe} stops following,
   * empties the list (notifying if anything was listed) and allows a new
   * connect.
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
  /** Bumps once per notified {@link FilterChange}; starts at 0. */
  readonly version: number;
  /**
   * Listeners run in subscription order. A throwing listener does not stop
   * the others; the first error is reported asynchronously (as a rejected
   * promise nobody handles), never thrown into the store, the correlator,
   * `connect` or `setFilter`, as with {@link Correlator.subscribe}. An
   * internal error while following the store is reported likewise, the list
   * left as it was. Listeners should not throw.
   */
  subscribe(listener: (change: FilterChange) => void): Unsubscribe;
}

/** The listed entries: the state run B maintains incrementally. */
interface Listing {
  /** Matching ids, in store list order. */
  readonly ids: readonly EntryId[];
  readonly positions: ReadonlyMap<EntryId, number>;
}

const EMPTY: Listing = { ids: [], positions: new Map() };

function sameIds(a: readonly EntryId[], b: readonly EntryId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function fieldMap(
  fields: readonly FilterFieldDefinition[] | undefined,
): ReadonlyMap<string, FilterFieldDefinition> {
  const map = new Map<string, FilterFieldDefinition>();
  for (const field of fields ?? []) {
    if (map.has(field.id)) {
      throw new RangeError(`duplicate filter field id ${JSON.stringify(field.id)}`);
    }
    map.set(field.id, field);
  }
  return map;
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
  const correlator = options?.correlator;
  const payloadSearch = options?.payloadSearch === true;
  const ctx: MatchContext = { fields, ...(correlator !== undefined && { correlator }) };
  const listeners = createListeners<FilterChange>();
  let compiled: CompiledFilter = compileFilter({}, fields, payloadSearch);
  let listing = EMPTY;
  let version = 0;
  let source: ViewerStore | undefined;
  let connected: object | undefined;

  /** Recomputes the listing from the store; whether the ids changed. */
  function refresh(store: ViewerStore): boolean {
    const ids: EntryId[] = [];
    const positions = new Map<EntryId, number>();
    for (const entry of store.toArray()) {
      if (!matchesFilter(entry, compiled, ctx)) continue;
      positions.set(entry.id, ids.length);
      ids.push(entry.id);
    }
    const changed = !sameIds(listing.ids, ids);
    listing = { ids, positions };
    return changed;
  }

  function emit(): void {
    version += 1;
    try {
      listeners.emit({ version });
    } catch (error) {
      report(error);
    }
  }

  /** Refreshes and notifies; an error is reported, the listing left as it was. */
  function update(store: ViewerStore): void {
    let changed: boolean;
    try {
      changed = refresh(store);
    } catch (error) {
      report(error);
      return;
    }
    if (changed) emit();
  }

  /** Empties the listing, notifying if anything was listed. */
  function release(): void {
    const had = listing.ids.length > 0;
    listing = EMPTY;
    source = undefined;
    if (had) emit();
  }

  const engine: FilterEngine = {
    connect(store) {
      if (connected !== undefined) throw new Error("the filter engine is already connected");
      const connection = {};
      try {
        refresh(store);
      } catch (error) {
        listing = EMPTY;
        throw error;
      }
      connected = connection;
      source = store;
      if (listing.ids.length > 0) emit();

      function follow(): void {
        if (connected === connection) update(store);
      }
      const onStore = (_change: ViewerStoreChange): void => follow();
      const onCorrelator = (_change: CorrelationChange): void => follow();

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
      if (source !== undefined) update(source);
    },
    reset() {
      engine.setFilter({});
    },
    get size() {
      return listing.ids.length;
    },
    at(index) {
      const id = Number.isInteger(index) ? listing.ids[index] : undefined;
      return id === undefined ? undefined : source?.get(id);
    },
    indexOf(id) {
      return listing.positions.get(id) ?? -1;
    },
    matches(entry) {
      return matchesFilter(entry, compiled, ctx);
    },
    get version() {
      return version;
    },
    subscribe(listener) {
      return listeners.subscribe(listener);
    },
  };
  return engine;
}

/** Creates a {@link FilterEngine} listing every entry until a filter is set. */
export function createFilterEngine(options?: FilterEngineOptions): FilterEngine {
  return createFilterEngineWith(options, (error) => {
    void Promise.reject(error);
  });
}
