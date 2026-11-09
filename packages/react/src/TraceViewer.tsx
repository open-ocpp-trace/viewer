import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ColumnDefinition,
  Correlator,
  EntryId,
  FilterFieldDefinition,
  TraceFilter,
  ViewerSelection,
  ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { FilterPanel } from "./FilterPanel.tsx";
import { useFilterEngine } from "./hooks.ts";
import { defaultStrings } from "./strings.ts";
import { TraceList } from "./TraceList.tsx";

/** Props of {@link TraceViewer}. */
export interface TraceViewerProps {
  /** The entries to show; the host owns the store and feeds it. */
  store: ViewerStore;
  /** A correlator the host connected to `store`, for derived actions. */
  correlator?: Correlator;
  /** Producer fields to filter on: memoize the array. */
  fields?: readonly FilterFieldDefinition[];
  /** Lets the text search look into payloads too. */
  payloadSearch?: boolean;
  /** Host columns, appended after the built-in ones. */
  columns?: readonly ColumnDefinition[];
  /** The current filter; controlled when defined. */
  filter?: TraceFilter;
  /** The initial filter when uncontrolled. */
  defaultFilter?: TraceFilter;
  /** Called with every filter the user builds, in both modes. */
  onFilterChange?: (filter: TraceFilter) => void;
  /** The selected entry; controlled when defined. */
  selection?: ViewerSelection;
  /** The initial selection when uncontrolled. */
  defaultSelection?: ViewerSelection;
  /**
   * Called when the user selects an entry, and once with `{ entryId: null }`
   * when the selected entry leaves the store (evicted or cleared), in both
   * modes. An entry the filter hides stays selected.
   */
  onSelectionChange?: (selection: ViewerSelection) => void;
  /** Shows a loading message while nothing is listed. */
  loading?: boolean;
  /** A host error message, announced as an alert. */
  error?: string | null;
  className?: string;
}

/** The store's version, re-rendering the component on every change. */
function useStoreVersion(store: ViewerStore): number {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const version = (): number => store.version;
  return useSyncExternalStore(subscribe, version, version);
}

/**
 * The whole viewer: a toolbar (pause, follow), a {@link FilterPanel} and a
 * {@link TraceList} over the host's store. React only renders: the store
 * bounds the entries and the engine filters them.
 */
export function TraceViewer(props: TraceViewerProps): ReactElement {
  const { store, correlator, fields, payloadSearch, selection, onSelectionChange } = props;
  const strings = defaultStrings.toolbar;
  const engine = useFilterEngine(store, {
    ...(correlator !== undefined && { correlator }),
    ...(fields !== undefined && { fields }),
    ...(payloadSearch !== undefined && { payloadSearch }),
  });
  useStoreVersion(store);
  const { paused, pending } = store.getStats();
  const [follow, setFollow] = useState(true);

  const [ownSelection, setOwnSelection] = useState<EntryId | null>(
    props.defaultSelection?.entryId ?? null,
  );
  const controlled = selection !== undefined;
  const selectedId = controlled ? selection.entryId : ownSelection;
  const select = (entryId: EntryId | null): void => {
    if (!controlled) setOwnSelection(entryId);
    onSelectionChange?.({ entryId });
  };

  // The store listener reads the latest props through this ref; `announced`
  // holds the id already reported gone, so a parent that keeps a stale
  // controlled selection hears about it once.
  const latest = useRef({ selectedId, controlled, onSelectionChange });
  const announced = useRef<EntryId | null>(null);
  useEffect(() => {
    latest.current = { selectedId, controlled, onSelectionChange };
    if (selectedId !== announced.current) announced.current = null;
  });
  useEffect(
    () =>
      store.subscribe(() => {
        const {
          selectedId: id,
          controlled: isControlled,
          onSelectionChange: notify,
        } = latest.current;
        if (id === null || id === announced.current || store.get(id) !== undefined) return;
        announced.current = id;
        if (!isControlled) setOwnSelection(null);
        notify?.({ entryId: null });
      }),
    [store],
  );

  const className = props.className === undefined ? "oot-viewer" : `oot-viewer ${props.className}`;
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="oot-toolbar">
        <button
          type="button"
          className="oot-toolbar-button"
          aria-pressed={paused}
          onClick={() => (paused ? store.resume() : store.pause())}
        >
          {strings.pause}
        </button>
        {paused ? <span className="oot-pending">{strings.pending(pending)}</span> : null}
        <button
          type="button"
          className="oot-toolbar-button"
          aria-pressed={follow}
          onClick={() => setFollow(!follow)}
        >
          {strings.follow}
        </button>
      </div>
      <div className="oot-viewer-body" style={{ display: "flex", flex: "1 1 auto", minHeight: 0 }}>
        <FilterPanel
          engine={engine}
          {...(props.filter !== undefined && { filter: props.filter })}
          {...(props.defaultFilter !== undefined && { defaultFilter: props.defaultFilter })}
          {...(props.onFilterChange !== undefined && { onFilterChange: props.onFilterChange })}
          {...(fields !== undefined && { fields })}
          {...(payloadSearch !== undefined && { payloadSearch })}
        />
        <div className="oot-viewer-list" style={{ flex: "1 1 auto", minWidth: 0 }}>
          <TraceList
            engine={engine}
            {...(correlator !== undefined && { correlator })}
            {...(props.columns !== undefined && { columns: props.columns })}
            {...(props.loading !== undefined && { loading: props.loading })}
            {...(props.error !== undefined && { error: props.error })}
            selectedId={selectedId}
            onSelectedIdChange={select}
            follow={follow}
            onFollowChange={setFollow}
          />
        </div>
      </div>
    </div>
  );
}
