import type { Unsubscribe, ViewerAdapter } from "./adapter.ts";
import type { ViewerEntry } from "./entry.ts";
import type { EntryUpdate } from "./update.ts";

/** What {@link connectAdapter} needs from the store. */
export interface ConnectTarget {
  apply(batch: readonly EntryUpdate[]): void;
  load(entries: readonly ViewerEntry[]): void;
  /** Lists a store gap with `reason: "unknown"`: the snapshot is missing. */
  snapshotFailed(): void;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === "function";

/**
 * Feeds `target` from `adapter` per the ADR adapter contract: subscribe and
 * buffer, apply the snapshot, replay the buffer in order, then forward each
 * batch. A snapshot that rejects or is not an array lists a store gap.
 */
export function connectAdapter(target: ConnectTarget, adapter: ViewerAdapter): Unsubscribe {
  let stopped = false;
  // Batches received before the snapshot applied; undefined once forwarding.
  let buffer: (readonly EntryUpdate[])[] | undefined = [];
  let unsubscribe: Unsubscribe | undefined;
  const stop: Unsubscribe = () => {
    if (stopped) return;
    stopped = true;
    buffer = undefined;
    unsubscribe?.();
  };

  const settle = (snapshot: unknown): void => {
    if (stopped) return;
    if (Array.isArray(snapshot)) target.load(snapshot);
    else target.snapshotFailed();
    // Batches emitted during the replay join the same buffer, in order.
    const batches = buffer ?? [];
    for (let position = 0; !stopped && position < batches.length; position++) {
      target.apply(batches[position] as readonly EntryUpdate[]);
    }
    buffer = undefined;
  };

  unsubscribe = adapter.subscribe((batch) => {
    if (stopped) return;
    if (buffer === undefined) target.apply(batch);
    else buffer.push(batch);
  });
  let snapshot: unknown;
  try {
    snapshot = adapter.snapshot();
    if (isThenable(snapshot)) {
      // Handled at once, so a rejection after `stop` is never unhandled.
      snapshot.then(settle, () => settle(undefined));
      return stop;
    }
  } catch (error) {
    stop();
    throw error;
  }
  settle(snapshot);
  return stop;
}
