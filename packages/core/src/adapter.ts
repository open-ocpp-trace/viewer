import type { ViewerEntry } from "./entry.ts";
import type { EntryUpdate } from "./update.ts";

/** Stops a subscription; calling it again has no effect. */
export type Unsubscribe = () => void;

/**
 * Feeds a viewer from one producer. The viewer takes the snapshot, then
 * subscribes to incremental updates, delivered in batches. Transports and
 * codecs stay in the adapter: a connection loss is reported as a `gap` entry.
 */
export interface ViewerAdapter {
  snapshot(): readonly ViewerEntry[] | Promise<readonly ViewerEntry[]>;
  subscribe(listener: (updates: readonly EntryUpdate[]) => void): Unsubscribe;
}
