import { type ReactNode, useEffect, useRef } from "react";

import type {
  Correlator,
  EntryId,
  TraceFilter,
  ViewerEntry,
  ViewerSelection,
  ViewerStore,
} from "@open-ocpp-trace/viewer-core";

/**
 * What a {@link ToolbarAction} sees when it runs or decides whether it is
 * disabled: the viewer's state at that moment.
 */
export interface ViewerActionContext {
  readonly store: ViewerStore;
  readonly selection: ViewerSelection;
  /** The selected entry, when it is in the store. */
  readonly selectedEntry: ViewerEntry | undefined;
  /** The entries the filter lists, in order (a fresh array per call). */
  listed(): ViewerEntry[];
  /** Selects like a row click: `onSelectionChange` is called. */
  select(entryId: EntryId | null): void;
}

/**
 * A host button of the viewer's toolbar, rendered after the built-in ones.
 * Its label is shown as given (`translate` does not apply).
 */
export interface ToolbarAction {
  /** Keys the button; a later action with the same id is ignored. */
  readonly id: string;
  readonly label: string;
  /** Disabled when it returns true; re-evaluated on every render. */
  disabled?(context: ViewerActionContext): boolean;
  run(context: ViewerActionContext): void;
}

/** What a {@link FilterControl} reads and edits. */
export interface FilterControlContext {
  /** The panel's current filter. */
  readonly filter: TraceFilter;
  /**
   * Builds a new filter, like a built-in control: the engine validates it
   * and `onFilterChange` is called.
   */
  setFilter(next: TraceFilter): void;
}

/**
 * A host control of the filter panel, rendered after the built-in groups
 * in a fieldset with `label` as its legend; it typically edits
 * `filter.fields` for a `FilterFieldDefinition` id. A throw while
 * rendering shows the `filterControlError` string in its place until
 * another control object is passed.
 */
export interface FilterControl {
  /** Keys the control; a later control with the same id is ignored. */
  readonly id: string;
  readonly label: string;
  render(context: FilterControlContext): ReactNode;
}

/** What a {@link DetailPanel} renders. */
export interface DetailPanelContext {
  /** The selected entry, present in the store. */
  readonly entry: ViewerEntry;
  readonly store: ViewerStore;
  readonly correlator: Correlator | undefined;
  /** Selects like a paired link of the inspector: `onSelectionChange` is called. */
  select(entryId: EntryId | null): void;
}

/**
 * A host section rendered under the inspector for the selected entry, with
 * `title` as its heading (shown as given). A throw while rendering shows the
 * `detailPanelError` string in its place until another entry is selected.
 */
export interface DetailPanel {
  /** Keys the panel; a later panel with the same id is ignored. */
  readonly id: string;
  readonly title: string;
  /** Contextual: the panel shows only for entries it accepts (default: all). */
  appliesTo?(entry: ViewerEntry): boolean;
  render(context: DetailPanelContext): ReactNode;
}

/**
 * The slots of `items` with distinct ids, the first of each id kept; a
 * duplicate id is reported once per id with `console.warn`.
 */
export function useUniqueSlots<T extends { readonly id: string }>(
  items: readonly T[] | undefined,
  kind: string,
): readonly T[] {
  const ids = new Set<string>();
  const unique: T[] = [];
  const duplicates: string[] = [];
  for (const item of items ?? []) {
    if (ids.has(item.id)) duplicates.push(item.id);
    else {
      ids.add(item.id);
      unique.push(item);
    }
  }
  const warned = useRef(new Set<string>());
  const key = JSON.stringify(duplicates);
  useEffect(() => {
    for (const id of JSON.parse(key) as string[]) {
      if (warned.current.has(id)) continue;
      warned.current.add(id);
      console.warn(`Duplicate ${kind} id "${id}": only the first one is rendered.`);
    }
  }, [key, kind]);
  return unique;
}

/**
 * Calls a host slot's `render` as a component of its own, so the hooks it
 * uses belong to it and an error boundary above it catches its throws. The
 * element type never changes, so a new slot identity does not remount what
 * it returned.
 */
export function SlotContent<C>(props: {
  slot: { render(context: C): ReactNode };
  context: C;
}): ReactNode {
  return props.slot.render(props.context);
}
