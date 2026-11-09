import type { ViewerEntry } from "./entry.ts";
import type { EntryUpdate } from "./update.ts";

/** Stops a subscription; calling it again has no effect. */
export type Unsubscribe = () => void;

/**
 * Feeds a viewer from one producer. The viewer subscribes first and buffers
 * the batches it receives, then applies the snapshot (entries without a
 * revision), then replays the buffer in order; an entry present in both is a
 * duplicate `add`, ignored. Transports and codecs stay in the adapter: a
 * connection loss is reported as a `gap` entry.
 */
export interface ViewerAdapter {
  snapshot(): readonly ViewerEntry[] | Promise<readonly ViewerEntry[]>;
  subscribe(listener: (updates: readonly EntryUpdate[]) => void): Unsubscribe;
}
