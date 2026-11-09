import { createElement, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import {
  createCorrelator,
  createViewerStore,
  type ColumnDefinition,
  type CorrelationScope,
  type Correlator,
  type EntryUpdate,
  type FilterFieldDefinition,
  type TraceFilter,
  type Unsubscribe,
  type ViewerAdapter,
  type ViewerEntry,
  type ViewerSelection,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import {
  type ExportScope,
  type InspectorPart,
  type JsonlExport,
  type PartialViewerStrings,
  type ToolbarAction,
  TraceViewer,
  type TraceViewerProps,
  type TranslateFunction,
  type ViewerTheme,
} from "@open-ocpp-trace/viewer-react";
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

/**
 * Options {@link ViewerInstance.setOptions} can change after mounting. Each
 * one has the meaning of the `<TraceViewer>` prop of the same name; an
 * `undefined` value stands for the prop's default. Callbacks are read when
 * they are called, so a new function never re-runs an earlier change.
 */
export interface LiveOptions {
  /** Producer fields to filter on. */
  readonly fields?: readonly FilterFieldDefinition[] | undefined;
  /** Lets the text search look into payloads too. */
  readonly payloadSearch?: boolean | undefined;
  /** Host columns, appended after the built-in ones. */
  readonly columns?: readonly ColumnDefinition[] | undefined;
  /** The current filter; controlled when defined. */
  readonly filter?: TraceFilter | undefined;
  /** The initial filter when uncontrolled. */
  readonly defaultFilter?: TraceFilter | undefined;
  /** Called with every filter the user builds. */
  readonly onFilterChange?: ((filter: TraceFilter) => void) | undefined;
  /** The selected entry; controlled when defined. */
  readonly selection?: ViewerSelection | undefined;
  /** The initial selection when uncontrolled. */
  readonly defaultSelection?: ViewerSelection | undefined;
  /** Called when the user selects an entry, or when the selected one leaves the store. */
  readonly onSelectionChange?:
    | ((selection: ViewerSelection, entry: ViewerEntry | undefined) => void)
    | undefined;
  /** Shows a loading message while nothing is listed. */
  readonly loading?: boolean | undefined;
  /** A host error message, announced as an alert. */
  readonly error?: string | null | undefined;
  /** Copy handler of the detail panel. */
  readonly onCopy?: ((text: string, part: InspectorPart) => void) | undefined;
  /** Shows sensitive fields in the detail panel. */
  readonly revealSensitive?: boolean | undefined;
  /** Property names the detail panel redacts. */
  readonly sensitiveKeys?: readonly string[] | undefined;
  /** Receives an export the user asked for; the export buttons show only with it. */
  readonly onExport?: ((exported: JsonlExport, scope: ExportScope) => void) | undefined;
  /** The color scheme and token overrides of this viewer. */
  readonly theme?: ViewerTheme | undefined;
  /** Overrides of the default strings. */
  readonly strings?: PartialViewerStrings | undefined;
  /** Translates each string by its key, before `strings` and the defaults. */
  readonly translate?: TranslateFunction | undefined;
  /** Host buttons, rendered after the built-in toolbar buttons. */
  readonly toolbarActions?: readonly ToolbarAction[] | undefined;
}

/** The options of {@link mount}. */
export type MountOptions = MountOnlyOptions & LiveOptions;

/** A viewer mounted by {@link mount}. */
export interface ViewerInstance {
  /** Adds a snapshot or new entries; an id already held is ignored. */
  ingest(entries: readonly ViewerEntry[]): void;
  /** Applies untrusted updates (adds and metadata updates), as `ViewerStore.apply`. */
  update(batch: readonly EntryUpdate[]): void;
  /**
   * Merges `options` into the live options and renders again. A
   * {@link MountOnlyOptions} key throws a `TypeError`.
   */
  setOptions(options: LiveOptions): void;
  /** Removes the viewer and stops the adapter; calling it again has no effect. */
  unmount(): void;
}

const CONTAINER_ATTRIBUTE = "data-oot-standalone";

const MOUNT_ONLY: readonly (keyof MountOnlyOptions)[] = [
  "maxEntries",
  "maxBytes",
  "correlation",
  "adapter",
  "entries",
  "nonce",
];

// Every live option, checked against `LiveOptions` in both directions; only
// these keys reach `<TraceViewer>` as props.
const LIVE_KEYS = Object.keys({
  fields: true,
  payloadSearch: true,
  columns: true,
  filter: true,
  defaultFilter: true,
  onFilterChange: true,
  selection: true,
  defaultSelection: true,
  onSelectionChange: true,
  loading: true,
  error: true,
  onCopy: true,
  revealSensitive: true,
  sensitiveKeys: true,
  onExport: true,
  theme: true,
  strings: true,
  translate: true,
  toolbarActions: true,
} satisfies Record<keyof LiveOptions, true>) as readonly (keyof LiveOptions)[];

const KNOWN_KEYS: ReadonlySet<string> = new Set<string>([...MOUNT_ONLY, ...LIVE_KEYS]);

/** Throws a `TypeError` naming the first key of `options` that no option has. */
function rejectUnknown(options: object, caller: string): void {
  for (const key of Object.keys(options)) {
    if (!KNOWN_KEYS.has(key)) throw new TypeError(`${caller}: unknown option "${key}"`);
  }
}

// Lets the viewer fill the host element; the host can still size the
// container from outside, as its rules beat `:host`.
const LAYOUT_CSS = ":host{display:block;height:100%}.oot-standalone-root{height:100%}";

// One string for every mount, so the stylesheet cache of styles.ts hits it.
const STYLES = viewerCss + LAYOUT_CSS;

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && (value as Node).nodeType === 1;
}

/**
 * Mounts a viewer in `element`, inside the open shadow root of a container
 * it appends there, and renders it before returning.
 */
export function mount(element: Element, options: MountOptions = {}): ViewerInstance {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("mount() needs an options object");
  }
  const { maxEntries, maxBytes, correlation, adapter, entries, nonce, ...initial } = options;
  if (!isElement(element)) throw new TypeError("mount() needs an Element to mount into");
  rejectUnknown(options, "mount()");
  let live: LiveOptions = initial;
  for (const child of Array.from(element.children)) {
    if (child.hasAttribute(CONTAINER_ATTRIBUTE)) {
      throw new Error("A viewer is already mounted in this element: unmount it first");
    }
  }
  const document = element.ownerDocument;
  const container = document.createElement("div");
  container.setAttribute(CONTAINER_ATTRIBUTE, "");
  const shadow = container.attachShadow({ mode: "open" });
  attachStyles(shadow, STYLES, nonce);
  const node = document.createElement("div");
  node.className = "oot-standalone-root";
  shadow.append(node);

  const store = createViewerStore({
    ...(maxEntries === undefined ? {} : { maxEntries }),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
  const correlator =
    correlation === false
      ? undefined
      : createCorrelator(correlation === undefined ? {} : { scope: correlation });
  const stops: Unsubscribe[] = [];
  let root: Root | undefined;
  const teardown = (): void => {
    for (const stop of stops.splice(0).reverse()) stop();
    root?.unmount();
    container.remove();
  };

  try {
    if (correlator !== undefined) stops.push(correlator.connect(store));
    if (entries !== undefined) store.load(entries);
    element.append(container);
    if (adapter !== undefined) stops.push(store.connect(adapter));
    const created = createRoot(node);
    root = created;
    flushSync(() => created.render(viewer(store, correlator, live)));
  } catch (error) {
    teardown();
    throw error;
  }

  let mounted = true;
  const ensureMounted = (): void => {
    if (!mounted) throw new Error("This viewer instance is unmounted");
  };
  return {
    ingest(added) {
      ensureMounted();
      flushSync(() => store.load(added));
    },
    update(batch) {
      ensureMounted();
      flushSync(() => store.apply(batch));
    },
    setOptions(changes) {
      ensureMounted();
      for (const key of MOUNT_ONLY) {
        if (key in changes) {
          throw new TypeError(`"${key}" can only be set by mount(), not by setOptions()`);
        }
      }
      rejectUnknown(changes, "setOptions()");
      live = { ...live, ...changes };
      flushSync(() => root.render(viewer(store, correlator, live)));
    },
    unmount() {
      if (!mounted) return;
      mounted = false;
      teardown();
    },
  };
}

function viewer(
  store: ViewerStore,
  correlator: Correlator | undefined,
  options: LiveOptions,
): ReactElement {
  // Only live options are read; an `undefined` one is left out, so the prop
  // takes its default. The store and correlator are set last, so no option
  // can replace them.
  const props: Record<string, unknown> = {};
  for (const key of LIVE_KEYS) {
    const value = options[key];
    if (value !== undefined) props[key] = value;
  }
  props["store"] = store;
  if (correlator !== undefined) props["correlator"] = correlator;
  return createElement(TraceViewer, props as unknown as TraceViewerProps);
}
