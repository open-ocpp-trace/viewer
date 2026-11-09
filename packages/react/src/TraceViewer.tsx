import {
  type ReactElement,
  type ReactNode,
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
  FilterEngine,
  FilterFieldDefinition,
  TraceFilter,
  ViewerEntry,
  ViewerSelection,
  TraceEntry,
  ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { EntryInspector, type InspectorPart } from "./EntryInspector.tsx";
import { exportJsonl, type JsonlExport } from "./export-jsonl.ts";
import { FilterPanel } from "./FilterPanel.tsx";
import { useEngineVersion, useFilterEngine, useStableCallback } from "./hooks.ts";
import { reportHostError } from "./report-error.ts";
import { ResetBoundary } from "./reset-boundary.tsx";
import {
  type DetailPanel,
  type DetailPanelContext,
  type FilterControl,
  SlotContent,
  type ToolbarAction,
  useUniqueSlots,
  type ViewerActionContext,
} from "./slots.tsx";
import type { PartialViewerStrings, TranslateFunction } from "./strings.ts";
import { StringsContext, useStrings, useViewerStrings } from "./strings-context.ts";
import { themeStyle, type ViewerTheme } from "./theme.ts";
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
   * Called when the user (or a host slot) selects an entry, with that entry
   * when the store holds it, and once with `{ entryId: null }` and
   * `undefined` when the selected entry leaves the store (evicted or
   * cleared), in both modes. It is read at call time: a new identity per
   * render is never called for an earlier change. An entry the filter hides stays selected. Only an eviction or a
   * clear of the store counts as leaving: an id not listed yet (restored
   * from a URL before its entry arrives) stays selected and shows once the
   * entry is added, and so does an entry dropped from the pending queue
   * while paused, which never was listed. The `{ entryId: null }`
   * call runs in an effect after the store change, never inside the store's
   * notification: an error it throws is passed to `reportError` (or
   * `console.error`) and neither reaches `store.apply()` nor unmounts the
   * viewer.
   */
  onSelectionChange?: (selection: ViewerSelection, entry: ViewerEntry | undefined) => void;
  /** Shows a loading message while nothing is listed. */
  loading?: boolean;
  /** A host error message, announced as an alert. */
  error?: string | null;
  /** Copy handler of the detail panel, as `EntryInspectorProps.onCopy`. */
  onCopy?: (text: string, part: InspectorPart) => void;
  /**
   * Payload rendering of the detail panel, as `EntryInspectorProps.renderPayload`.
   * `entry` is the untouched entry, sensitive fields included; render `text`
   * to keep the redaction.
   */
  renderPayload?: (text: string, entry: TraceEntry) => ReactNode;
  /**
   * Shows sensitive fields in the detail panel, as
   * `EntryInspectorProps.revealSensitive` (raw frames fail closed without it).
   */
  revealSensitive?: boolean;
  /** Property names the detail panel redacts, as `EntryInspectorProps.sensitiveKeys`. */
  sensitiveKeys?: readonly string[];
  /**
   * Receives an export the user asked for, built with {@link exportJsonl}:
   * the selected entry (`"selection"`) or every entry the filter lists, in
   * order (`"filtered"`). The host downloads or copies `exported.text`. The
   * export buttons render only when this is given. Records are exported
   * unmodified: the detail panel's redaction does not apply.
   */
  onExport?: (exported: JsonlExport, scope: ExportScope) => void;
  /**
   * The color scheme and token overrides of this viewer, set on its root
   * element (`data-oot-color-scheme` and inline `--oot-*` properties).
   */
  theme?: ViewerTheme;
  /**
   * Overrides of `defaultStrings`, for the viewer and every component it
   * renders. Memoize it: a new identity resolves every string again.
   */
  strings?: PartialViewerStrings;
  /**
   * Translates each string by its key, before `strings` and the defaults;
   * see `TranslateFunction`. Memoize it, like `strings`. A throw is
   * reported and the string falls back.
   */
  translate?: TranslateFunction;
  /** Host buttons, rendered after the built-in toolbar buttons. */
  toolbarActions?: readonly ToolbarAction[];
  /** Host controls of the filter panel, as `FilterPanelProps.filterControls`. */
  filterControls?: readonly FilterControl[];
  /** Host sections shown under the inspector for the selected entry. */
  detailPanels?: readonly DetailPanel[];
  className?: string;
}

const ROOT_STYLE = { display: "flex", flexDirection: "column", height: "100%" } as const;

/** What an export of {@link TraceViewer} covers. */
export type ExportScope = "selection" | "filtered";

/** The entries the engine lists, in order. */
function* listed(engine: FilterEngine): Generator<ViewerEntry> {
  for (let index = 0; index < engine.size; index += 1) {
    const entry = engine.at(index);
    if (entry !== undefined) yield entry;
  }
}

/**
 * A host toolbar button; a throw of `disabled` disables it. Keyed by the
 * action id, it reports that throw once, not on every render.
 */
function HostAction(props: { action: ToolbarAction; context: ViewerActionContext }): ReactElement {
  const { action, context } = props;
  const reported = useRef(false);
  let disabled = false;
  try {
    disabled = action.disabled?.(context) === true;
  } catch (error) {
    if (!reported.current) {
      reported.current = true;
      reportHostError(error);
    }
    disabled = true;
  }
  const run = (): void => {
    try {
      action.run(context);
    } catch (error) {
      reportHostError(error);
    }
  };
  return (
    <button type="button" className="oot-toolbar-button" disabled={disabled} onClick={run}>
      {action.label}
    </button>
  );
}

/** Whether `panel` shows for `entry`; a throw of `appliesTo` hides it. */
function applies(panel: DetailPanel, entry: ViewerEntry): boolean {
  try {
    return panel.appliesTo?.(entry) ?? true;
  } catch (error) {
    reportHostError(error);
    return false;
  }
}

/** A host detail panel; a render throw shows a fallback until the entry changes. */
function HostPanel(props: { panel: DetailPanel; context: DetailPanelContext }): ReactElement {
  const { panel, context } = props;
  const fallback = <p className="oot-detail-panel__error">{useStrings().detailPanelError}</p>;
  return (
    <section className="oot-detail-panel" aria-label={panel.title}>
      <h3>{panel.title}</h3>
      <ResetBoundary fallback={fallback} resetKeys={[context.entry.id]}>
        <SlotContent slot={panel} context={context} />
      </ResetBoundary>
    </section>
  );
}

/** The store's version, re-rendering the component on every change. */
function useStoreVersion(store: ViewerStore): number {
  const subscribe = useCallback((onChange: () => void) => store.subscribe(onChange), [store]);
  const version = (): number => store.version;
  return useSyncExternalStore(subscribe, version, version);
}

/**
 * The whole viewer: a toolbar (pause, follow), a {@link FilterPanel}, a
 * {@link TraceList} over the host's store and an {@link EntryInspector}
 * detailing the selection. React only renders: the store bounds the entries
 * and the engine filters them.
 */
export function TraceViewer(props: TraceViewerProps): ReactElement {
  const { store, correlator, fields, payloadSearch, selection, onSelectionChange } = props;
  const allStrings = useViewerStrings(props.strings, props.translate);
  const strings = allStrings.toolbar;
  const engine = useFilterEngine(store, {
    ...(correlator !== undefined && { correlator }),
    ...(fields !== undefined && { fields }),
    ...(payloadSearch !== undefined && { payloadSearch }),
  });
  useStoreVersion(store);
  // Host actions read `listed()`: a filter change re-renders them too.
  useEngineVersion(engine);
  const { paused, pending } = store.getStats();
  const [follow, setFollow] = useState(true);

  const [ownSelection, setOwnSelection] = useState<EntryId | null>(
    props.defaultSelection?.entryId ?? null,
  );
  const controlled = selection !== undefined;
  const selectedId = controlled ? selection.entryId : ownSelection;
  const select = (entryId: EntryId | null): void => {
    if (!controlled) setOwnSelection(entryId);
    onSelectionChange?.({ entryId }, entryId === null ? undefined : store.get(entryId));
  };
  // A paired link of the detail panel selects like a row click; like a
  // click on an older row, a target other than the newest one (or one the
  // filter hides) stops following.
  const navigate = (entryId: EntryId): void => {
    if (follow && engine.at(engine.size - 1)?.id !== entryId) setFollow(false);
    select(entryId);
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
  // The listener only sets state, which never throws, so the host's
  // `store.apply()` cannot fail because of the viewer. A fresh object per
  // announcement re-runs the effect below even for the same id.
  const [gone, setGone] = useState<{ readonly id: EntryId } | null>(null);
  useEffect(
    () =>
      store.subscribe((change) => {
        const { selectedId: id, controlled: isControlled } = latest.current;
        if (id === null || id === announced.current) return;
        // Left the store: an id never listed yet (restored from a URL before
        // its entry arrives) stays selected until the entry shows up.
        if (!change.cleared && !change.evicted.includes(id)) return;
        announced.current = id;
        if (!isControlled) setOwnSelection(null);
        setGone({ id });
      }),
    [store],
  );
  // Declared after the effect refreshing `latest`, so it reads this render's
  // callback; keyed on `gone` only, so a new callback identity never repeats
  // the announcement.
  useEffect(() => {
    if (gone === null) return;
    try {
      latest.current.onSelectionChange?.({ entryId: null }, undefined);
    } catch (error) {
      reportHostError(error);
    }
  }, [gone]);

  // The last export's result, announced by a status region; formatted at
  // render time, so a change of strings applies to it too.
  const [exported, setExported] = useState<{ count: number; skipped: number } | null>(null);
  const { onExport } = props;
  const selectedEntry = selectedId === null ? undefined : store.get(selectedId);
  const runExport = (entries: Iterable<ViewerEntry>, scope: ExportScope): void => {
    const exported = exportJsonl(entries);
    const { unparsed, gap, invalid } = exported.skipped;
    setExported({ count: exported.recordCount, skipped: unparsed + gap + invalid });
    onExport?.(exported, scope);
  };

  // Host slots select like a paired link of the inspector, through the
  // latest render even when they kept an earlier context.
  const hostSelect = useStableCallback((entryId: EntryId | null): void =>
    entryId === null ? select(null) : navigate(entryId),
  );
  const listedNow = useStableCallback((): ViewerEntry[] => [...listed(engine)]);
  const toolbarActions = useUniqueSlots(props.toolbarActions, "toolbar action");
  const detailPanels = useUniqueSlots(props.detailPanels, "detail panel");
  const actionContext: ViewerActionContext = {
    store,
    selection: { entryId: selectedId },
    selectedEntry,
    listed: listedNow,
    select: hostSelect,
  };

  const panelContext: DetailPanelContext | undefined = selectedEntry && {
    entry: selectedEntry,
    store,
    correlator,
    select: hostSelect,
  };

  const className = props.className === undefined ? "oot-viewer" : `oot-viewer ${props.className}`;
  return (
    <StringsContext.Provider value={allStrings}>
      <div
        className={className}
        data-oot-color-scheme={props.theme?.colorScheme ?? "auto"}
        style={themeStyle(props.theme, ROOT_STYLE)}
      >
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
          {onExport === undefined ? null : (
            <>
              <button
                type="button"
                className="oot-toolbar-button"
                disabled={selectedEntry === undefined}
                onClick={() => selectedEntry && runExport([selectedEntry], "selection")}
              >
                {strings.exportSelection}
              </button>
              <button
                type="button"
                className="oot-toolbar-button"
                onClick={() => runExport(listed(engine), "filtered")}
              >
                {strings.exportFiltered}
              </button>
              <span className="oot-export-status" role="status">
                {exported === null ? "" : strings.exported(exported.count, exported.skipped)}
              </span>
            </>
          )}
          {toolbarActions.map((action) => (
            <HostAction key={action.id} action={action} context={actionContext} />
          ))}
        </div>
        <div
          className="oot-viewer-body"
          style={{ display: "flex", flex: "1 1 auto", minHeight: 0 }}
        >
          <FilterPanel
            engine={engine}
            {...(props.filter !== undefined && { filter: props.filter })}
            {...(props.defaultFilter !== undefined && { defaultFilter: props.defaultFilter })}
            {...(props.onFilterChange !== undefined && { onFilterChange: props.onFilterChange })}
            {...(fields !== undefined && { fields })}
            {...(payloadSearch !== undefined && { payloadSearch })}
            {...(props.filterControls !== undefined && { filterControls: props.filterControls })}
          />
          <div className="oot-viewer-list" style={{ flex: "1 1 auto" }}>
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
          <div className="oot-viewer__detail">
            <EntryInspector
              store={store}
              entryId={selectedId}
              {...(correlator !== undefined && { correlator })}
              onNavigate={navigate}
              {...(props.onCopy !== undefined && { onCopy: props.onCopy })}
              {...(props.renderPayload !== undefined && { renderPayload: props.renderPayload })}
              {...(props.revealSensitive !== undefined && {
                revealSensitive: props.revealSensitive,
              })}
              {...(props.sensitiveKeys !== undefined && { sensitiveKeys: props.sensitiveKeys })}
            />
            {panelContext &&
              detailPanels.map((panel) =>
                applies(panel, panelContext.entry) ? (
                  <HostPanel key={panel.id} panel={panel} context={panelContext} />
                ) : null,
              )}
          </div>
        </div>
      </div>
    </StringsContext.Provider>
  );
}
