import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import {
  createCorrelator,
  createViewerStore,
  type CorrelationScope,
  type Correlator,
  type EntryUpdate,
  type Unsubscribe,
  type ViewerAdapter,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { TraceViewer } from "@open-ocpp-trace/viewer-react";
import viewerCss from "@open-ocpp-trace/viewer-react/styles.css?inline";

import { attachStyles } from "./styles.ts";

/** Options read once, by {@link mount}. */
export interface MountOnlyOptions {
  /** The store's entry limit, as `ViewerStoreOptions.maxEntries`. */
  readonly maxEntries?: number;
  /** The store's byte limit, as `ViewerStoreOptions.maxBytes`. */
  readonly maxBytes?: number;
  /** The correlation scope (default `"conversation"`); `false` disables correlation. */
  readonly correlation?: CorrelationScope | false;
  /** The producer feeding the viewer, connected with `store.connect`. */
  readonly adapter?: ViewerAdapter;
  /** An initial snapshot, ingested before the first render. */
  readonly entries?: readonly ViewerEntry[];
  /**
   * A CSP nonce for the `<style>` element used where constructable
   * stylesheets are not supported.
   */
  readonly nonce?: string;
}

/** The options of {@link mount}. */
export type MountOptions = MountOnlyOptions;

/** A viewer mounted by {@link mount}. */
export interface ViewerInstance {
  /** Adds a snapshot or new entries; an id already held is ignored. */
  ingest(entries: readonly ViewerEntry[]): void;
  /** Applies untrusted updates (add, update, remove, gap…), as `ViewerStore.apply`. */
  update(batch: readonly EntryUpdate[]): void;
  /** Removes the viewer and stops the adapter; calling it again has no effect. */
  unmount(): void;
}

const CONTAINER_ATTRIBUTE = "data-oot-standalone";

// Lets the viewer fill the host element; the host can still size the
// container from outside, as its rules beat `:host`.
const LAYOUT_CSS = ":host{display:block;height:100%}.oot-standalone-root{height:100%}";

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && (value as Node).nodeType === 1;
}

/**
 * Mounts a viewer in `element`, inside the open shadow root of a container
 * it appends there, and renders it before returning.
 */
export function mount(element: Element, options: MountOptions = {}): ViewerInstance {
  if (!isElement(element)) throw new TypeError("mount() needs an Element to mount into");
  for (const child of Array.from(element.children)) {
    if (child.hasAttribute(CONTAINER_ATTRIBUTE)) {
      throw new Error("A viewer is already mounted in this element: unmount it first");
    }
  }
  const document = element.ownerDocument;
  const container = document.createElement("div");
  container.setAttribute(CONTAINER_ATTRIBUTE, "");
  const shadow = container.attachShadow({ mode: "open" });
  attachStyles(shadow, viewerCss + LAYOUT_CSS, options.nonce);
  const node = document.createElement("div");
  node.className = "oot-standalone-root";
  shadow.append(node);

  const store = createViewerStore({
    ...(options.maxEntries === undefined ? {} : { maxEntries: options.maxEntries }),
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  });
  const scope = options.correlation;
  const correlator =
    scope === false ? undefined : createCorrelator(scope === undefined ? {} : { scope });
  const stops: Unsubscribe[] = [];
  let root: Root | undefined;
  const teardown = (): void => {
    for (const stop of stops.splice(0).reverse()) stop();
    root?.unmount();
    container.remove();
  };

  try {
    if (correlator !== undefined) stops.push(correlator.connect(store));
    if (options.entries !== undefined) store.load(options.entries);
    element.append(container);
    if (options.adapter !== undefined) stops.push(store.connect(options.adapter));
    root = createRoot(node);
    render(root, store, correlator);
  } catch (error) {
    teardown();
    throw error;
  }

  let mounted = true;
  const live = (): void => {
    if (!mounted) throw new Error("This viewer instance is unmounted");
  };
  return {
    ingest(entries) {
      live();
      flushSync(() => store.load(entries));
    },
    update(batch) {
      live();
      flushSync(() => store.apply(batch));
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      teardown();
    },
  };
}

function render(root: Root, store: ViewerStore, correlator: Correlator | undefined): void {
  flushSync(() => {
    root.render(
      createElement(TraceViewer, { store, ...(correlator === undefined ? {} : { correlator }) }),
    );
  });
}
