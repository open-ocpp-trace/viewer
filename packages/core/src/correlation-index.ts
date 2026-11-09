import type { EntryId } from "./entry.ts";

/** Direction of a correlatable record. */
export type Direction = "cp-to-csms" | "csms-to-cp";

/**
 * A listed CALL. Its scope key (`chargePoint`, `session`) is frozen when the
 * CALL is first seen; `null` is the unknown value, never equal to a string.
 */
export interface CallNode {
  readonly id: EntryId;
  readonly messageId: string;
  readonly direction: Direction;
  readonly action: string;
  readonly chargePoint: string | null;
  readonly session: string | null;
  answered: boolean;
}

/** Most recent listed CALLs scanned for candidates, per (direction, messageId). */
export const CANDIDATE_SCAN_LIMIT = 64;

/** Candidates kept per response. */
export const CANDIDATE_LIMIT = 8;

/** Candidates of one response, newest first. */
export interface CandidateScan {
  readonly candidates: readonly EntryId[];
  readonly truncated: boolean;
}

/**
 * Listed CALLs, oldest first, with a head offset: entries leave from the
 * front (eviction) or the back (answer), each in O(1) amortized.
 */
class Deque<T> {
  #items: (T | undefined)[] = [];
  #head = 0;

  get size(): number {
    return this.#items.length - this.#head;
  }

  push(item: T): void {
    this.#items.push(item);
  }

  newest(): T | undefined {
    return this.size > 0 ? this.#items[this.#items.length - 1] : undefined;
  }

  pop(): T | undefined {
    return this.size > 0 ? this.#items.pop() : undefined;
  }

  /** Removes `item`, expected at the front (eviction) or the back. */
  remove(item: T): void {
    if (this.size === 0) return;
    if (this.#items[this.#head] === item) {
      this.#items[this.#head] = undefined;
      this.#head += 1;
      if (this.#head > 32 && this.#head * 2 > this.#items.length) {
        this.#items = this.#items.slice(this.#head);
        this.#head = 0;
      }
    } else if (this.newest() === item) {
      this.#items.pop();
    } else {
      const at = this.#items.indexOf(item, this.#head);
      if (at >= 0) this.#items.splice(at, 1);
    }
  }

  *newestFirst(): Generator<T> {
    for (let i = this.#items.length - 1; i >= this.#head; i -= 1) yield this.#items[i] as T;
  }
}

type ByMessageId<V> = Map<Direction, Map<string, V>>;
type Buckets = Map<string | null, Map<string | null, Deque<CallNode>>>;

/**
 * Indexes of the listed CALLs: every CALL per (direction, messageId) for the
 * bounded candidate scan, and the unanswered ones per (direction, messageId,
 * charge point, session) as stacks for the match. Nested `Map`s only, so no
 * key copies a `messageId` and untrusted strings are plain data.
 */
export interface CallIndex {
  add(node: CallNode): void;
  /** Pops and marks answered the newest unanswered CALL of that bucket. */
  answer(
    direction: Direction,
    messageId: string,
    chargePoint: string | null,
    session: string | null,
  ): CallNode | undefined;
  /** Drops an evicted CALL from every index. */
  remove(node: CallNode): void;
  /** Scans the newest listed CALLs with that id, keeping those `accept`ed. */
  scan(direction: Direction, messageId: string, accept: (node: CallNode) => boolean): CandidateScan;
  /** Test hook: CALLs held by each index. */
  sizes(): { readonly calls: number; readonly unanswered: number };
}

export function createCallIndex(): CallIndex {
  const calls: ByMessageId<Deque<CallNode>> = new Map();
  const unanswered: ByMessageId<Buckets> = new Map();

  function child<K, V>(map: Map<K, V>, key: K, create: () => V): V {
    let value = map.get(key);
    if (value === undefined) {
      value = create();
      map.set(key, value);
    }
    return value;
  }

  function stackOf(node: CallNode): Deque<CallNode> {
    const ids = child(unanswered, node.direction, () => new Map<string, Buckets>());
    const points = child(ids, node.messageId, (): Buckets => new Map());
    const sessions = child(
      points,
      node.chargePoint,
      () => new Map<string | null, Deque<CallNode>>(),
    );
    return child(sessions, node.session, () => new Deque<CallNode>());
  }

  /** Removes `node` from its stack, then any map left empty. */
  function unstack(node: CallNode, pop: boolean): CallNode | undefined {
    const ids = unanswered.get(node.direction);
    const points = ids?.get(node.messageId);
    const sessions = points?.get(node.chargePoint);
    const stack = sessions?.get(node.session);
    if (ids === undefined || points === undefined || sessions === undefined) return undefined;
    if (stack === undefined) return undefined;
    let removed: CallNode | undefined = node;
    if (pop) removed = stack.pop();
    else stack.remove(node);
    if (stack.size > 0) return removed;
    sessions.delete(node.session);
    if (sessions.size > 0) return removed;
    points.delete(node.chargePoint);
    if (points.size > 0) return removed;
    ids.delete(node.messageId);
    if (ids.size === 0) unanswered.delete(node.direction);
    return removed;
  }

  return {
    add(node) {
      const ids = child(calls, node.direction, () => new Map<string, Deque<CallNode>>());
      child(ids, node.messageId, () => new Deque<CallNode>()).push(node);
      stackOf(node).push(node);
    },
    answer(direction, messageId, chargePoint, session) {
      const newest = unanswered
        .get(direction)
        ?.get(messageId)
        ?.get(chargePoint)
        ?.get(session)
        ?.newest();
      if (newest === undefined) return undefined;
      unstack(newest, true);
      newest.answered = true;
      return newest;
    },
    remove(node) {
      const ids = calls.get(node.direction);
      const list = ids?.get(node.messageId);
      if (ids !== undefined && list !== undefined) {
        list.remove(node);
        if (list.size === 0) {
          ids.delete(node.messageId);
          if (ids.size === 0) calls.delete(node.direction);
        }
      }
      if (!node.answered) unstack(node, false);
    },
    scan(direction, messageId, accept) {
      const candidates: EntryId[] = [];
      const list = calls.get(direction)?.get(messageId);
      if (list === undefined) return { candidates, truncated: false };
      let scanned = 0;
      for (const node of list.newestFirst()) {
        if (scanned === CANDIDATE_SCAN_LIMIT) return { candidates, truncated: true };
        scanned += 1;
        if (!accept(node)) continue;
        if (candidates.length === CANDIDATE_LIMIT) return { candidates, truncated: true };
        candidates.push(node.id);
      }
      return { candidates, truncated: false };
    },
    sizes() {
      let all = 0;
      let open = 0;
      for (const ids of calls.values()) for (const list of ids.values()) all += list.size;
      for (const ids of unanswered.values()) {
        for (const points of ids.values()) {
          for (const sessions of points.values()) {
            for (const stack of sessions.values()) open += stack.size;
          }
        }
      }
      return { calls: all, unanswered: open };
    },
  };
}
