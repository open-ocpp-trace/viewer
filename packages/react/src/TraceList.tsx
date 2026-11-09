import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  useCallback,
  useId,
  useRef,
} from "react";

import {
  type ColumnDefinition,
  type Correlator,
  type EntryFields,
  type FilterEngine,
  readEntryFields,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { useEngineVersion } from "./hooks.ts";
import { defaultStrings as strings } from "./strings.ts";

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
] as const satisfies readonly (readonly [keyof typeof strings.columns, keyof EntryFields])[];

/** Built-in columns an unparsed row fills before its marker cell. */
const UNPARSED_LEADING = 4;
const DEFAULT_ROW_HEIGHT = 28;
const OVERSCAN = 8;
const PREVIEW_LENGTH = 120;

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

function gapText(entry: ViewerEntry): string {
  const count = own(entry, "missedCount");
  const reason = own(entry, "reason");
  return strings.gap(
    typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null,
    typeof reason === "string" ? reason : null,
  );
}

function unparsedMarker(entry: ViewerEntry): ReactElement {
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
): ReactElement[] {
  if (entry.kind === "gap") {
    return [cell("gap", "oot-cell--gap", gapText(entry), BUILT_IN.length + columns.length)];
  }
  const fields = readEntryFields(entry, correlator);
  if (entry.kind === "unparsed") {
    return [
      ...builtInCells(fields, UNPARSED_LEADING),
      unparsedMarker(entry),
      ...hostCells(columns, entry),
    ];
  }
  return [...builtInCells(fields, BUILT_IN.length), ...hostCells(columns, entry)];
}

const ROW_STYLE: CSSProperties = { display: "flex" };

/**
 * The entries an engine lists, as a virtualized ARIA grid: only the visible
 * rows are in the DOM. Trace content is rendered as text only. The list
 * fills its parent's height (`height: 100%`), so the parent must be sized.
 */
export function TraceList(props: TraceListProps): ReactElement {
  const { engine, correlator, columns = [], loading = false, error = null, className } = props;
  const rowHeight = props.rowHeight ?? DEFAULT_ROW_HEIGHT;
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
  });

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
          {virtualizer.getVirtualItems().map((item) => {
            const entry = engine.at(item.index);
            if (entry === undefined) return null;
            return (
              <div
                key={item.key}
                id={`${baseId}-row-${item.index}`}
                role="row"
                aria-rowindex={item.index + 2}
                data-entry-id={entry.id}
                className={`oot-row oot-row--${entry.kind}`}
                style={{
                  ...rowStyle,
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start - rowHeight}px)`,
                }}
              >
                {rowCells(entry, columns, correlator)}
              </div>
            );
          })}
        </div>
      </div>
      {message}
    </div>
  );
}
