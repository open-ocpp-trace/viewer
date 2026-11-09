import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  type ColumnDefinition,
  type Correlator,
  type EntryFields,
  type EntryId,
  type FilterEngine,
  readEntryFields,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { useEngineVersion } from "./hooks.ts";
import type { PartialViewerStrings, TranslateFunction, ViewerStrings } from "./strings.ts";
import { useViewerStrings } from "./strings-context.ts";

/** Props of {@link TraceList}. */
export interface TraceListProps {
  /** The engine whose matching entries are listed (see `useFilterEngine`). */
  engine: FilterEngine;
  /** Source of the actions derived for responses, in the action column. */
  correlator?: Correlator;
  /** Host columns, appended after the built-in ones. */
  columns?: readonly ColumnDefinition[];
  /** Shows a loading message while nothing is listed. */
  loading?: boolean;
  /** A host error message, announced as an alert. */
  error?: string | null;
  /** Fixed row height in pixels. Defaults to 28. */
  rowHeight?: number;
  className?: string;
  "aria-label"?: string;
  /** The selected entry; the list does not keep a selection of its own. */
  selectedId?: EntryId | null;
  /** Called when a click or a key selects an entry. */
  onSelectedIdChange?: (id: EntryId | null) => void;
  /**
   * Whether the list keeps the newest entry in view; controlled when
   * defined, else on until the user scrolls up or selects an older entry
   * with the keyboard.
   */
  follow?: boolean;
  /** Called whenever the list turns following on or off. */
  onFollowChange?: (follow: boolean) => void;
  /** Overrides of `defaultStrings`, as `TraceViewerProps.strings`. */
  strings?: PartialViewerStrings;
  /** Translates the strings, as `TraceViewerProps.translate`. */
  translate?: TranslateFunction;
}

/** Built-in columns, in display order. */
const BUILT_IN = [
  ["timestamp", "timestamp"],
  ["chargePoint", "chargePointId"],
  ["connector", "connectorId"],
  ["direction", "direction"],
  ["messageType", "messageType"],
  ["action", "action"],
  ["messageId", "messageId"],
] as const satisfies readonly (readonly [keyof ViewerStrings["columns"], keyof EntryFields])[];

/** Built-in columns an unparsed row fills before its marker cell. */
const UNPARSED_LEADING = 4;
const DEFAULT_ROW_HEIGHT = 28;
const OVERSCAN = 8;
const PREVIEW_LENGTH = 120;

/** `useLayoutEffect` in a browser; `useEffect` on a server, which warns on the former. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Reads one property of an untrusted entry; never throws. */
function own(entry: ViewerEntry, key: string): unknown {
  try {
    return (entry as unknown as Readonly<Record<string, unknown>>)[key];
  } catch {
    return undefined;
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hostValue(column: ColumnDefinition, entry: ViewerEntry): string {
  let value: unknown;
  try {
    value = column.value(entry);
  } catch {
    return "";
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function cell(key: string, className: string, content: ReactNode, colSpan?: number): ReactElement {
  return (
    <div key={key} role="gridcell" className={`oot-cell ${className}`} aria-colspan={colSpan}>
      {content}
    </div>
  );
}

function builtInCells(fields: EntryFields, count: number): ReactElement[] {
  return BUILT_IN.slice(0, count).map(([id, field]) => {
    const value = fields[field];
    return cell(id, `oot-cell--${id}`, value === null ? "" : String(value));
  });
}

function hostCells(columns: readonly ColumnDefinition[], entry: ViewerEntry): ReactElement[] {
  return columns.map((column, index) =>
    cell(`host-${index}`, "oot-cell--host", hostValue(column, entry)),
  );
}

function gapText(entry: ViewerEntry, strings: ViewerStrings): string {
  const count = own(entry, "missedCount");
  const reason = own(entry, "reason");
  return strings.gap(
    typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null,
    typeof reason === "string" ? reason : null,
  );
}

function unparsedMarker(entry: ViewerEntry, strings: ViewerStrings): ReactElement {
  const raw = textOf(own(entry, "raw"));
  const preview = raw.length > PREVIEW_LENGTH ? `${raw.slice(0, PREVIEW_LENGTH)}…` : raw;
  return cell(
    "unparsed",
    "oot-cell--unparsed",
    <>
      <span className="oot-badge">{strings.unparsed}</span>{" "}
      <span className="oot-unparsed-reason">{textOf(own(entry, "reason"))}</span>{" "}
      <span className="oot-unparsed-raw">{preview}</span>
    </>,
    BUILT_IN.length - UNPARSED_LEADING,
  );
}

function rowCells(
  entry: ViewerEntry,
  columns: readonly ColumnDefinition[],
  correlator: Correlator | undefined,
  strings: ViewerStrings,
): ReactElement[] {
  if (entry.kind === "gap") {
    return [
      cell("gap", "oot-cell--gap", gapText(entry, strings), BUILT_IN.length + columns.length),
    ];
  }
  const fields = readEntryFields(entry, correlator);
  if (entry.kind === "unparsed") {
    return [
      ...builtInCells(fields, UNPARSED_LEADING),
      unparsedMarker(entry, strings),
      ...hostCells(columns, entry),
    ];
  }
  return [...builtInCells(fields, BUILT_IN.length), ...hostCells(columns, entry)];
}

const ROW_STYLE: CSSProperties = { display: "flex" };

/** The index a navigation key moves the selection to, or null for other keys. */
function targetIndex(key: string, current: number, count: number, page: number): number | null {
  const offsets: Readonly<Record<string, number>> = {
    ArrowDown: 1,
    ArrowUp: -1,
    PageDown: page,
    PageUp: -page,
  };
  let next: number;
  if (key === "Home") next = 0;
  else if (key === "End") next = count - 1;
  else if (offsets[key] === undefined) return null;
  // With nothing selected, going down starts at the top and up at the bottom.
  else if (current < 0) next = offsets[key] > 0 ? 0 : count - 1;
  else next = current + offsets[key];
  return Math.max(0, Math.min(count - 1, next));
}

/**
 * The entries an engine lists, as a virtualized ARIA grid: only the visible
 * rows are in the DOM. Trace content is rendered as text only. The list
 * fills its parent's height (`height: 100%`), so the parent must be sized.
 */
export function TraceList(props: TraceListProps): ReactElement {
  const { engine, correlator, columns = [], loading = false, error = null, className } = props;
  const rowHeight = props.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const strings = useViewerStrings(props.strings, props.translate);
  const version = useEngineVersion(engine);
  const baseId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const count = engine.size;
  // A new version may list other entries at the same indexes.
  const getItemKey = useCallback(
    (index: number) => engine.at(index)?.id ?? index,
    [engine, version],
  );
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey,
    overscan: OVERSCAN,
    // The sticky header row sits above the first entry row.
    scrollMargin: rowHeight,
    // A row scrolled to the start lands below that header, not under it.
    scrollPaddingStart: rowHeight,
  });

  const { selectedId = null, onSelectedIdChange, onFollowChange } = props;
  const [ownFollow, setOwnFollow] = useState(true);
  const following = props.follow ?? ownFollow;
  const followControlled = props.follow !== undefined;
  const setFollow = useCallback(
    (next: boolean) => {
      if (!followControlled) setOwnFollow(next);
      onFollowChange?.(next);
    },
    [followControlled, onFollowChange],
  );

  useEffect(() => {
    if (following && count > 0) virtualizer.scrollToIndex(count - 1, { align: "end" });
  }, [following, count, version, virtualizer]);

  // A browser fires `scroll` after the list's own writes too, possibly after
  // a later batch moved the bottom further: only an upward move that does not
  // end at the bottom is the user's (a shrinking list also moves up).
  const lastTop = useRef(0);
  // The first row under the header, by id: evictions and filter changes move
  // its index, and the scroll position must follow it when not following.
  const anchor = useRef<{ id: EntryId; index: number } | null>(null);
  const onScroll = (): void => {
    const element = scrollRef.current;
    if (element === null) return;
    const top = element.scrollTop;
    const movedUp = top < lastTop.current - rowHeight / 2;
    lastTop.current = top;
    const firstIndex = Math.floor(top / rowHeight);
    const first = engine.at(firstIndex);
    anchor.current = first === undefined ? null : { id: first.id, index: firstIndex };
    const atBottom = top + element.clientHeight >= element.scrollHeight - rowHeight / 2;
    if (following && movedUp && !atBottom) setFollow(false);
  };

  // Before paint, so the viewed rows never visibly jump; an evicted anchor
  // falls back to the top of the list.
  useIsomorphicLayoutEffect(() => {
    const element = scrollRef.current;
    const current = anchor.current;
    if (following || element === null || current === null) return;
    const index = engine.indexOf(current.id);
    const top = index < 0 ? 0 : element.scrollTop + (index - current.index) * rowHeight;
    if (index < 0) anchor.current = null;
    else current.index = index;
    if (top === element.scrollTop) return;
    element.scrollTop = top;
    // Not the user's move: `onScroll` must not read it as one.
    lastTop.current = element.scrollTop;
  }, [engine, version, following, rowHeight]);

  const selectedIndex = selectedId === null ? -1 : engine.indexOf(selectedId);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const page = Math.max(1, Math.floor(event.currentTarget.clientHeight / rowHeight) - 1);
    const next = targetIndex(event.key, selectedIndex, count, page);
    const entry = next === null ? undefined : engine.at(next);
    if (next === null || entry === undefined) return;
    event.preventDefault();
    if (following && next < count - 1) setFollow(false);
    onSelectedIdChange?.(entry.id);
    virtualizer.scrollToIndex(next);
  };
  const items = virtualizer.getVirtualItems();
  const activeRendered = items.some((item) => item.index === selectedIndex);

  let message: ReactElement | null = null;
  if (count === 0) {
    message = loading ? (
      <div role="status" className="oot-list-message">
        {strings.loading}
      </div>
    ) : (
      <div className="oot-list-message">
        {engine.getStats().buffer.total > 0 ? strings.noMatch : strings.empty}
      </div>
    );
  }

  const rowStyle = { ...ROW_STYLE, height: rowHeight };
  return (
    <div
      className={className === undefined ? "oot-list" : `oot-list ${className}`}
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      {error ? (
        <div role="alert" className="oot-list-error">
          {error}
        </div>
      ) : null}
      <div
        ref={scrollRef}
        role="grid"
        aria-label={props["aria-label"] ?? strings.listLabel}
        aria-rowcount={count + 1}
        aria-colcount={BUILT_IN.length + columns.length}
        aria-activedescendant={activeRendered ? `${baseId}-row-${selectedIndex}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={onScroll}
        className="oot-grid"
        style={{ flex: "1 1 auto", minHeight: 0, overflow: "auto", position: "relative" }}
      >
        <div role="rowgroup" style={{ position: "sticky", top: 0, zIndex: 1 }}>
          <div role="row" aria-rowindex={1} className="oot-row oot-row--header" style={rowStyle}>
            {BUILT_IN.map(([id]) => (
              <div key={id} role="columnheader" className={`oot-cell oot-cell--${id}`}>
                {strings.columns[id]}
              </div>
            ))}
            {columns.map((column, index) => (
              <div key={`host-${index}`} role="columnheader" className="oot-cell oot-cell--host">
                {column.label}
              </div>
            ))}
          </div>
        </div>
        <div
          role="rowgroup"
          style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}
        >
          {items.map((item) => {
            const entry = engine.at(item.index);
            if (entry === undefined) return null;
            const selected = item.index === selectedIndex;
            return (
              <div
                key={item.key}
                id={`${baseId}-row-${item.index}`}
                role="row"
                aria-rowindex={item.index + 2}
                aria-selected={selected}
                data-entry-id={entry.id}
                onClick={() => {
                  // Like the keyboard: an older row would scroll out of view.
                  if (following && item.index < count - 1) setFollow(false);
                  onSelectedIdChange?.(entry.id);
                }}
                className={`oot-row oot-row--${entry.kind}${selected ? " oot-row--selected" : ""}`}
                style={{
                  ...rowStyle,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start - rowHeight}px)`,
                }}
              >
                {rowCells(entry, columns, correlator, strings)}
              </div>
            );
          })}
        </div>
      </div>
      {following ? null : (
        <button type="button" className="oot-jump" onClick={() => setFollow(true)}>
          {strings.jumpToLatest}
        </button>
      )}
      {message}
    </div>
  );
}
