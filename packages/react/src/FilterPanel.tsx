import { useEffect, useState, type ReactElement } from "react";

import type {
  FilterEngine,
  FilterFieldDefinition,
  TraceFilter,
} from "@open-ocpp-trace/viewer-core";

import { sameFilter } from "./same-filter.ts";
import { defaultStrings } from "./strings.ts";

/** Props of {@link FilterPanel}. */
export interface FilterPanelProps {
  engine: FilterEngine;
  /** The current filter; the panel is controlled when it is defined. */
  filter?: TraceFilter;
  /** The initial filter of an uncontrolled panel, else `engine.filter`. */
  defaultFilter?: TraceFilter;
  /** Called with every filter the user builds, in both modes. */
  onFilterChange?: (filter: TraceFilter) => void;
  /** Labels of the producer fields: the same array as the engine's. */
  fields?: readonly FilterFieldDefinition[];
  /** Shows the "search payloads" toggle; the engine must allow payload search. */
  payloadSearch?: boolean;
  className?: string;
}

/**
 * Controls building a {@link TraceFilter}, which the panel applies to
 * `engine`: the engine filters, the panel only edits plain data. The
 * current filter is pushed with `setFilter` only when it differs
 * structurally from `engine.filter`, so a fresh object per render does not
 * re-filter. A filter the engine rejects is shown as an alert and leaves the
 * engine unchanged.
 */
export function FilterPanel(props: FilterPanelProps): ReactElement {
  const { engine, onFilterChange } = props;
  const strings = defaultStrings.filter;
  const [internal, setInternal] = useState<TraceFilter>(() => props.defaultFilter ?? engine.filter);
  const controlled = props.filter !== undefined;
  const current = props.filter ?? internal;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sameFilter(current, engine.filter)) {
      setError(null);
      return;
    }
    try {
      engine.setFilter(current);
      setError(null);
    } catch (caught) {
      if (!(caught instanceof RangeError)) throw caught;
      setError(caught.message);
    }
  }, [engine, current]);

  function change(next: TraceFilter): void {
    if (!controlled) setInternal(next);
    onFilterChange?.(next);
  }

  return (
    <div
      role="group"
      aria-label={strings.panelLabel}
      className={props.className === undefined ? "oot-filter" : `oot-filter ${props.className}`}
    >
      {error !== null && (
        <p role="alert" className="oot-filter-error">
          {`${strings.invalid}: ${error}`}
        </p>
      )}
      <button type="button" className="oot-filter-reset" onClick={() => change({})}>
        {strings.reset}
      </button>
    </div>
  );
}
