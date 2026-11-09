import type { Unsubscribe, ViewerAdapter } from "./adapter.ts";
import type { ViewerEntry } from "./entry.ts";
import { firstError } from "./store-listeners.ts";
import type { EntryUpdate } from "./update.ts";

/** What {@link connectAdapter} needs from the store. */
export interface ConnectTarget {
  /** Most items buffered while the snapshot is pending (at least 1). */
  readonly maxBuffered: number;
  apply(batch: readonly EntryUpdate[]): void;
  load(entries: readonly ViewerEntry[]): void;
  /** Lists a store gap with `reason: "unknown"`: the snapshot is missing. */
  snapshotFailed(): void;
  /** Lists a store gap with `reason: "dropped"` for buffered adds dropped. */
  bufferDropped(missedCount: number): void;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === "function";

/** A batch length read once; a hostile one counts as a single item. */
const itemCount = (batch: readonly EntryUpdate[]): number => {
  try {
    const length = batch.length;
    return Number.isSafeInteger(length) && length > 0 ? length : 1;
  } catch {
    return 1;
  }
};

/** The `add` items of a dropped batch; an unreadable item is not one. */
const addCount = (batch: readonly EntryUpdate[]): number => {
  let adds = 0;
  try {
    for (const item of batch) {
      try {
        if ((item as { type?: unknown } | null)?.type === "add") adds++;
      } catch {
        // Not readable: it would have been invalid.
      }
    }
  } catch {
    // A throwing iterator: count what was read.
  }
  return adds;
};

/**
 * Feeds `target` from `adapter` per the ADR adapter contract: subscribe and
 * buffer, apply the snapshot, replay the buffer in order, then forward each
 * batch. A snapshot that rejects or is not an array lists a store gap.
 *
 * While the snapshot is pending, the buffer keeps at most
 * `target.maxBuffered` items: past it, the oldest batches are dropped whole
 * (the newest is always kept) and a `dropped` gap is listed after the
 * snapshot. Errors thrown while settling (by store listeners) do not stop the
 * replay; the first one is rethrown for a synchronous snapshot, after
 * unsubscribing, and swallowed for a promised one.
 */
export function connectAdapter(target: ConnectTarget, adapter: ViewerAdapter): Unsubscribe {
  let stopped = false;
  // Batches received before the snapshot applied, from `head` on, with their
  // item counts; undefined once forwarding.
  let buffer: (readonly EntryUpdate[] | undefined)[] | undefined = [];
  const counts: number[] = [];
  let head = 0;
  let buffered = 0;
  let droppedAdds = 0;
  let dropped = false;
  // Set once settling starts: from then on nothing is dropped.
  let settling = false;
  let unsubscribe: Unsubscribe | undefined;
  const stop: Unsubscribe = () => {
    if (stopped) return;
    stopped = true;
    buffer = undefined;
    unsubscribe?.();
  };

  /** Buffers `batch`; only called while the buffer is defined. */
  const hold = (batch: readonly EntryUpdate[]) => {
    const pending = buffer!;
    pending.push(batch);
    if (settling) return;
    const count = itemCount(batch);
    counts.push(count);
    buffered += count;
    while (buffered > target.maxBuffered && pending.length - head > 1) {
      const oldest = pending[head] as readonly EntryUpdate[];
      pending[head] = undefined;
      buffered -= counts[head] as number;
      head++;
      droppedAdds += addCount(oldest);
      dropped = true;
    }
    // Releases the dropped slots once they are half the array: amortized O(1).
    if (head > 64 && head * 2 > pending.length) {
      pending.splice(0, head);
      counts.splice(0, head);
      head = 0;
    }
  };

  /**
   * Applies the snapshot, the dropped gap and the buffer, then switches to
   * forwarding. Each step runs even if an earlier one threw; the first error
   * is rethrown at the end.
   */
  const settle = (snapshot: unknown): void => {
    if (stopped) return;
    settling = true;
    // Defined: it is cleared only by `stop` or at the end of the one settle.
    const pending = buffer!;
    const errors = firstError();
    try {
      errors.run(() => {
        if (Array.isArray(snapshot)) target.load(snapshot);
        else target.snapshotFailed();
      });
      if (dropped && !stopped) errors.run(() => target.bufferDropped(droppedAdds));
      // Batches emitted during the replay join the same buffer, in order.
      for (let position = head; !stopped && position < pending.length; position++) {
        const batch = pending[position] as readonly EntryUpdate[];
        pending[position] = undefined;
        errors.run(() => target.apply(batch));
      }
    } finally {
      buffer = undefined;
    }
    errors.rethrow();
  };

  unsubscribe = adapter.subscribe((batch) => {
    if (stopped) return;
    if (buffer === undefined) target.apply(batch);
    else hold(batch);
  });
  let snapshot: unknown;
  try {
    snapshot = adapter.snapshot();
    if (isThenable(snapshot)) {
      // An untrusted thenable may call back late, twice, or both ways: it
      // takes effect once. Errors from settling are not reported, and the
      // chain is handled at once, so nothing is ever an unhandled rejection.
      let settled = false;
      const once = (value: unknown): void => {
        if (settled) return;
        settled = true;
        settle(value);
      };
      Promise.resolve(snapshot)
        .then(once, () => once(undefined))
        .then(undefined, () => undefined);
      return stop;
    }
    settle(snapshot);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
