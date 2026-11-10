/**
 * The page's counters: the adapter's own, and those of the viewer's store.
 * Every value is written with `textContent`.
 */
import type { ViewerStoreStats } from "@open-ocpp-trace/viewer-standalone";

import type { GatewayFeedCounters } from "./feed.ts";

/** The adapter's counters, shown as `#count-<kebab-case key>`. */
export const FEED_COUNTERS = [
  "received",
  "deliveryUpdates",
  "ignoredUpdates",
  "droppedByServer",
  "deliveryStatesEvicted",
  "invalid",
] as const satisfies readonly (keyof GatewayFeedCounters)[];

/** The viewer store's counters, shown as `#viewer-<kebab-case key>`. */
export const VIEWER_COUNTERS = [
  "listed",
  "pending",
  "evicted",
  "droppedPending",
  "unknownUpdates",
  "staleUpdates",
  "invalid",
] as const satisfies readonly (keyof ViewerStoreStats)[];

export interface CounterView {
  /** Shows `feed`, and `viewer` once a viewer is mounted. */
  render(feed: GatewayFeedCounters, viewer: ViewerStoreStats | undefined): void;
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Looks up every counter element once, with `byId`. */
export function createCounterView(byId: (id: string) => HTMLElement): CounterView {
  const feedElements = FEED_COUNTERS.map((key) => [key, byId(`count-${kebab(key)}`)] as const);
  const viewerElements = VIEWER_COUNTERS.map((key) => [key, byId(`viewer-${kebab(key)}`)] as const);
  return {
    render(feed, viewer) {
      for (const [key, element] of feedElements) element.textContent = String(feed[key]);
      if (viewer === undefined) return;
      for (const [key, element] of viewerElements) element.textContent = String(viewer[key]);
    },
  };
}
