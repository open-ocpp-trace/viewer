import type {
  EntryUpdate,
  Unsubscribe,
  ViewerAdapter,
  ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

/** An in-memory adapter: an empty snapshot, then the entries pushed to it. */
export interface LiveAdapter {
  readonly adapter: ViewerAdapter;
  /** Delivers `entries` as one batch of adds to every subscribed store. */
  readonly push: (entries: readonly ViewerEntry[]) => void;
}

export function createLiveAdapter(): LiveAdapter {
  const listeners = new Set<(updates: readonly EntryUpdate[]) => void>();
  return {
    adapter: {
      snapshot: () => [],
      subscribe(listener): Unsubscribe {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    push: (entries) => {
      if (entries.length === 0) return;
      const updates = entries.map((entry): EntryUpdate => ({ type: "add", entry }));
      for (const listener of listeners) listener(updates);
    },
  };
}
