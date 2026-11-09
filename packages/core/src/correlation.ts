import type { Unsubscribe } from "./adapter.ts";
import { type CallNode, createCallIndex, type Direction } from "./correlation-index.ts";
import type { EntryId, ViewerEntry } from "./entry.ts";
import { createListeners } from "./store-listeners.ts";
import type { ViewerStore, ViewerStoreChange, ViewerStoreStats } from "./store.ts";

/**
 * Which records may answer each other, on top of the same `messageId` and
 * opposite `direction`:
 *
 * - `conversation` (default): same effective charge point and same
 *   `metadata.sessionId`;
 * - `chargePoint`: same effective charge point;
 * - `global`: any record of the stream.
 *
 * The effective charge point is
 * `entry.record.chargePointId ?? entry.metadata?.chargePointId`. A missing
 * (or non-string) key component is unknown: unknown matches only unknown, so
 * a trace without any charge point or session behaves like `global`, and two
 * different known values never match. The key is computed once, when the
 * entry is first seen: a later metadata update does not re-correlate it.
 * `tenant` and `conversationId` are not part of any key. See
 * `docs/adr/0002-correlation-scope.md`.
 */
export type CorrelationScope = "conversation" | "chargePoint" | "global";

/** Options of {@link createCorrelator}. */
export interface CorrelatorOptions {
  /** Default `conversation`; any other value throws a `RangeError`. */
  readonly scope?: CorrelationScope;
}

/** A CALL. */
export interface CallCorrelation {
  readonly role: "call";
  readonly messageId: string;
  readonly action: string;
  /** The response that correlated with this CALL; absent while unanswered. */
  readonly responseId?: EntryId;
}

/**
 * A CALLRESULT or CALLERROR correlated with the most recent preceding
 * unanswered CALL with the same `messageId`, the opposite `direction` and the
 * same scope key.
 */
export interface ResponseCorrelation {
  readonly role: "response";
  readonly messageId: string;
  /** The CALL, kept after the CALL is evicted from the store. */
  readonly callId: EntryId;
  /** The effective action: the CALL's. */
  readonly action: string;
  /**
   * Other compatible CALLs still unanswered when the response was matched,
   * newest first. Non-empty means the match follows the rule but is
   * ambiguous. Compatible: same `messageId`, opposite direction, preceding,
   * and no key component with two different known values. Ids may refer to
   * entries evicted since.
   */
  readonly candidates: readonly EntryId[];
  /**
   * More than 8 candidates were found, or the scan of the 64 most recent
   * listed CALLs with that `messageId` stopped before exhausting them.
   */
  readonly candidatesTruncated: boolean;
}

/** A CALLRESULT or CALLERROR that correlates with no CALL. */
export interface OrphanCorrelation {
  readonly role: "orphan";
  readonly messageId: string;
  /** The response record's own explicit action, when it carries one. */
  readonly action?: string;
  /**
   * Compatible listed CALLs, answered or not, newest first: the CALL this
   * response may answer, never claimed. With a gateway mirroring one CALL to
   * several CSMS, the second answer is such an orphan.
   */
  readonly candidates: readonly EntryId[];
  /** As {@link ResponseCorrelation.candidatesTruncated}. */
  readonly candidatesTruncated: boolean;
  /**
   * Since connect or the last clear, the store evicted or dropped entries,
   * or listed a gap, before this response: its CALL may be missing.
   * Evictions and drops before connect count too, and so does an entry added
   * and evicted in one batch (read from the store's counters).
   */
  readonly incompleteHistory: boolean;
}

/** The correlation of one trace entry. */
export type EntryCorrelation = CallCorrelation | ResponseCorrelation | OrphanCorrelation;

/** One notification of a {@link Correlator}. */
export interface CorrelationChange {
  /** Equals {@link Correlator.version} after the change. */
  readonly version: number;
  /** Ids whose correlation appeared or changed, in list order of processing. */
  readonly changed: readonly EntryId[];
  /** Evicted ids that had a correlation. */
  readonly removed: readonly EntryId[];
  /**
   * Every correlation known before the change is gone: the store was
   * cleared, or the correlator was disconnected.
   */
  readonly cleared: boolean;
}

/**
 * Correlates the trace entries of one {@link ViewerStore}, incrementally and
 * in store list order, the unfiltered chronological stream: no filter or
 * selection can change a result. Records are never read twice, mutated or
 * written to.
 *
 * Memory: O(listed trace entries), so bounded by the store's `maxEntries`,
 * plus at most 8 candidates per response. Cost per store change:
 * O(added + evicted) amortized, plus a candidate scan of at most 64 CALLs per
 * response.
 */
export interface Correlator {
  readonly scope: CorrelationScope;
  /**
   * Subscribes to the store, seeds from the listed entries, then emits one
   * change if any correlates: a change a listener makes during that emission
   * is followed. From then on it follows the store's changes, one
   * {@link CorrelationChange} at most per store change: `cleared` resets
   * (emitting `cleared: true`), `evicted` ids leave every index (a response
   * keeps its `callId` and `action`), `added` entries are correlated in
   * order, `updated` entries are not re-correlated. One store at a time: a
   * second connect throws. If subscribing or reading the store throws,
   * connect drops the subscription it made, rethrows and stays
   * disconnected, without emitting. The returned
   * {@link Unsubscribe} stops following, resets the state (emitting
   * `cleared: true` if anything was correlated) and allows a new connect.
   */
  connect(store: ViewerStore): Unsubscribe;
  /** Undefined for an unknown id, a gap, an unparsed or uncorrelatable entry. */
  get(id: EntryId): EntryCorrelation | undefined;
  /** Listed CALLs without a response, in list order. */
  unansweredCalls(): readonly EntryId[];
  /** Listed orphan responses, in list order. */
  orphanResponses(): readonly EntryId[];
  /** Bumps once per emitted {@link CorrelationChange}. */
  readonly version: number;
  /**
   * Listeners run in subscription order. A throwing listener does not stop
   * the others; the first error is reported asynchronously (as a rejected
   * promise nobody handles), never thrown into the store or `connect`: the
   * correlator runs inside the store's listener, where an error would
   * surface in the unrelated caller of `apply`. The seed change emitted by
   * `connect` is reported the same way, since rethrowing would lose the
   * {@link Unsubscribe} and leave the correlator connected. An internal
   * error while following the store is reported likewise, after the change
   * collected so far is emitted.
   *
   * Under Node's default `--unhandled-rejections=throw`, such a rejection
   * terminates the process: listeners should not throw.
   */
  subscribe(listener: (change: CorrelationChange) => void): Unsubscribe;
}

/** Creates a {@link Correlator}; see {@link CorrelationScope}. */
export function createCorrelator(options?: CorrelatorOptions): Correlator {
  return createCorrelatorWith(options, (error) => {
    void Promise.reject(error);
  });
}

interface ReadRecord {
  readonly role: "call" | "response";
  readonly messageId: string;
  readonly direction: Direction;
  readonly action: string | undefined;
  readonly chargePoint: string | null;
  readonly session: string | null;
}

/** Reads each field of an untrusted record once; undefined if uncorrelatable. */
function readTrace(entry: ViewerEntry, scope: CorrelationScope): ReadRecord | undefined {
  try {
    if (entry.kind !== "trace") return undefined;
    const record = entry.record as unknown as Readonly<Record<string, unknown>>;
    const { messageType, messageId, direction, action, chargePointId } = record;
    if (typeof messageId !== "string") return undefined;
    if (direction !== "cp-to-csms" && direction !== "csms-to-cp") return undefined;
    let role: ReadRecord["role"];
    if (messageType === "CALL" && typeof action === "string") role = "call";
    else if (messageType === "CALLRESULT" || messageType === "CALLERROR") role = "response";
    else return undefined;
    const metadata = entry.metadata;
    let chargePoint: unknown = null;
    let session: unknown = null;
    if (scope !== "global") chargePoint = chargePointId ?? metadata?.chargePointId;
    if (scope === "conversation") session = metadata?.sessionId;
    return {
      role,
      messageId,
      direction,
      action: typeof action === "string" ? action : undefined,
      chargePoint: typeof chargePoint === "string" ? chargePoint : null,
      session: typeof session === "string" ? session : null,
    };
  } catch {
    return undefined;
  }
}

/** No key component holds two different known values. */
function compatible(node: CallNode, read: ReadRecord): boolean {
  return (
    (node.chargePoint === null ||
      read.chargePoint === null ||
      node.chargePoint === read.chargePoint) &&
    (node.session === null || read.session === null || node.session === read.session)
  );
}

function opposite(direction: Direction): Direction {
  return direction === "cp-to-csms" ? "csms-to-cp" : "cp-to-csms";
}

function checkScope(options: CorrelatorOptions | undefined): CorrelationScope {
  const scope = options?.scope ?? "conversation";
  if (scope !== "conversation" && scope !== "chargePoint" && scope !== "global") {
    throw new RangeError(`unknown correlation scope ${String(scope)}`);
  }
  return scope;
}

interface CorrelatorInternals {
  /** Entries held by each index. */
  indexSizes(): { readonly tracked: number; readonly calls: number; readonly unanswered: number };
}

const internals = new WeakMap<Correlator, CorrelatorInternals>();

/** Test hook: internal sizes of a correlator. Not exported from the package. */
export function correlatorInternals(correlator: Correlator): CorrelatorInternals {
  const found = internals.get(correlator);
  if (found === undefined) throw new TypeError("not a correlator");
  return found;
}

/**
 * {@link createCorrelator} with the function that receives listener errors.
 * Not exported from the package.
 */
export function createCorrelatorWith(
  options: CorrelatorOptions | undefined,
  report: (error: unknown) => void,
): Correlator {
  const scope = checkScope(options);
  const listeners = createListeners<CorrelationChange>();
  let index = createCallIndex();
  /** Correlated entries: the CALL node, or null for a response. */
  let tracked = new Map<EntryId, CallNode | null>();
  let results = new Map<EntryId, EntryCorrelation>();
  let unanswered = new Set<EntryId>();
  let orphans = new Set<EntryId>();
  let incomplete = false;
  let version = 0;
  let lists: { unanswered: readonly EntryId[]; orphans: readonly EntryId[] } | undefined;
  let connected: object | undefined;

  function snapshot(): { unanswered: readonly EntryId[]; orphans: readonly EntryId[] } {
    return { unanswered: Object.freeze([...unanswered]), orphans: Object.freeze([...orphans]) };
  }

  function reset(): void {
    index = createCallIndex();
    tracked = new Map();
    results = new Map();
    unanswered = new Set();
    orphans = new Set();
    incomplete = false;
    lists = undefined;
  }

  function set(id: EntryId, correlation: EntryCorrelation, changed: Set<EntryId>): void {
    results.set(id, Object.freeze(correlation));
    changed.add(id);
  }

  function process(entry: ViewerEntry, changed: Set<EntryId>): void {
    if (entry.kind === "gap") {
      incomplete = true;
      return;
    }
    const id = entry.id;
    if (tracked.has(id)) return;
    const read = readTrace(entry, scope);
    if (read === undefined) return;
    const { messageId } = read;
    if (read.role === "call") {
      const node: CallNode = {
        id,
        messageId,
        direction: read.direction,
        action: read.action ?? "",
        chargePoint: read.chargePoint,
        session: read.session,
        answered: false,
      };
      index.add(node);
      tracked.set(id, node);
      unanswered.add(id);
      set(id, { role: "call", messageId, action: node.action }, changed);
      return;
    }
    tracked.set(id, null);
    const direction = opposite(read.direction);
    const chosen = index.answer(direction, messageId, read.chargePoint, read.session);
    if (chosen === undefined) {
      const scan = index.scan(direction, messageId, (node) => compatible(node, read));
      orphans.add(id);
      set(
        id,
        {
          role: "orphan",
          messageId,
          ...(read.action !== undefined && { action: read.action }),
          candidates: Object.freeze(scan.candidates),
          candidatesTruncated: scan.truncated,
          incompleteHistory: incomplete,
        },
        changed,
      );
      return;
    }
    const scan = index.scan(
      direction,
      messageId,
      (node) => node !== chosen && !node.answered && compatible(node, read),
    );
    unanswered.delete(chosen.id);
    set(chosen.id, { role: "call", messageId, action: chosen.action, responseId: id }, changed);
    set(
      id,
      {
        role: "response",
        messageId,
        callId: chosen.id,
        action: chosen.action,
        candidates: Object.freeze(scan.candidates),
        candidatesTruncated: scan.truncated,
      },
      changed,
    );
  }

  /** Drops an evicted entry from every index; a response keeps its result's `callId`. */
  function evict(id: EntryId, removed: EntryId[]): void {
    const node = tracked.get(id);
    if (node === undefined) return;
    tracked.delete(id);
    if (node !== null) {
      index.remove(node);
      unanswered.delete(id);
    } else {
      orphans.delete(id);
    }
    if (results.delete(id)) removed.push(id);
  }

  function emit(changed: readonly EntryId[], removed: readonly EntryId[], cleared: boolean): void {
    if (changed.length === 0 && removed.length === 0 && !cleared) return;
    version += 1;
    lists = undefined;
    try {
      listeners.emit({ version, changed, removed, cleared });
    } catch (error) {
      report(error);
    }
  }

  const correlator: Correlator = {
    scope,
    connect(store) {
      if (connected !== undefined) throw new Error("the correlator is already connected");
      const connection = {};
      let seen: ViewerStoreStats;
      /** Applies one store change, collecting into `removed` and `changed`. */
      function follow(change: ViewerStoreChange, removed: EntryId[], changed: Set<EntryId>): void {
        const cleared = change.cleared;
        if (cleared) reset();
        const stats = store.getStats();
        // Counters restart from 0 on clear; events are net deltas, so an
        // entry added and evicted in one batch shows only in the counters.
        const before = cleared ? { evicted: 0, droppedPending: 0 } : seen;
        if (
          change.evicted.length > 0 ||
          stats.evicted > before.evicted ||
          stats.droppedPending > before.droppedPending
        ) {
          incomplete = true;
        }
        seen = stats;
        for (const id of change.evicted) evict(id, removed);
        for (const id of change.added) {
          const entry = store.get(id);
          if (entry !== undefined) process(entry, changed);
        }
      }

      /** Resets the state, emitting `cleared` if anything was correlated. */
      function release(): void {
        const had = results.size > 0;
        reset();
        emit([], [], had);
      }

      // Subscribe before seeding, so a change made by a listener of the seed
      // notification is followed; the listener ignores anything before then.
      let unsubscribeStore: Unsubscribe = () => {};
      const seeded = new Set<EntryId>();
      try {
        unsubscribeStore = store.subscribe(listener);
        seen = store.getStats();
        incomplete = seen.evicted > 0 || seen.droppedPending > 0;
        for (const entry of store.toArray()) process(entry, seeded);
      } catch (error) {
        // Nothing was emitted yet: drop the subscription and what was
        // seeded, and stay disconnected.
        unsubscribeStore();
        reset();
        throw error;
      }
      connected = connection;
      emit([...seeded], [], false);

      function listener(change: ViewerStoreChange): void {
        if (connected !== connection) return;
        const removed: EntryId[] = [];
        const changed = new Set<EntryId>();
        let failure: { error: unknown } | undefined;
        try {
          follow(change, removed, changed);
        } catch (error) {
          // Never leave silent partial state: emit what was applied.
          failure = { error };
          lists = undefined;
        }
        emit([...changed], removed, change.cleared);
        if (failure !== undefined) report(failure.error);
      }
      return () => {
        if (connected !== connection) return;
        connected = undefined;
        unsubscribeStore();
        release();
      };
    },
    get(id) {
      return results.get(id);
    },
    unansweredCalls() {
      lists ??= snapshot();
      return lists.unanswered;
    },
    orphanResponses() {
      lists ??= snapshot();
      return lists.orphans;
    },
    get version() {
      return version;
    },
    subscribe(listener) {
      return listeners.subscribe(listener);
    },
  };
  internals.set(correlator, {
    indexSizes() {
      return { tracked: tracked.size, ...index.sizes() };
    },
  });
  return correlator;
}
