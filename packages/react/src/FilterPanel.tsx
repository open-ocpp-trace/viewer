import { useEffect, useMemo, useState, type ReactElement } from "react";

import type {
  FilterEngine,
  FilterFieldDefinition,
  TraceFilter,
} from "@open-ocpp-trace/viewer-core";

import {
  DraftInput,
  Group,
  optionsOf,
  readList,
  type Value,
  ValueGroup,
} from "./filter-controls.tsx";
import { isRecord, readString } from "./guards.ts";
import { useStableCallback, useVersion } from "./hooks.ts";
import { ResetBoundary } from "./reset-boundary.tsx";
import { sameFilter } from "./same-filter.ts";
import { type FilterControl, SlotContent, useUniqueSlots } from "./slots.tsx";
import type { PartialViewerStrings, TranslateFunction } from "./strings.ts";
import { StringsContext, useViewerStrings } from "./strings-context.ts";

/** The list properties shown as checkbox groups, in display order. */
const LISTS = [
  "chargePointIds",
  "connectorIds",
  "ocppVersions",
  "directions",
  "messageTypes",
  "actions",
  "sessionIds",
  "tenants",
  "sourceIds",
  "deliveryStatuses",
] as const;

const KINDS = ["trace", "unparsed", "gap"] as const;

interface FieldSelection {
  readonly id: string;
  readonly values: readonly Value[];
}

function readFields(value: unknown): FieldSelection[] {
  return (readList(value) ?? []).flatMap((item: unknown) => {
    if (!isRecord(item) || typeof item["id"] !== "string") return [];
    return [{ id: item["id"], values: readList(item["values"]) ?? [] }];
  });
}

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
  /** Overrides of `defaultStrings`, as `TraceViewerProps.strings`. */
  strings?: PartialViewerStrings;
  /** Translates the strings, as `TraceViewerProps.translate`. */
  translate?: TranslateFunction;
  /** Host controls, rendered after the built-in groups. */
  filterControls?: readonly FilterControl[];
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
  const allStrings = useViewerStrings(props.strings, props.translate);
  const strings = allStrings.filter;
  const [internal, setInternal] = useState<TraceFilter>(() => props.defaultFilter ?? engine.filter);
  const controlled = props.filter !== undefined;
  const current = props.filter ?? internal;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let message: string | null = null;
    if (!sameFilter(current, engine.filter)) {
      try {
        engine.setFilter(current);
      } catch (caught) {
        if (!(caught instanceof RangeError)) throw caught;
        message = caught.message;
      }
    }
    setError(message);
  }, [engine, current]);

  useVersion(engine);
  // The same object while the engine version is unchanged.
  const stats = engine.getStats().buffer;
  const view = useMemo(
    (): Readonly<Record<string, unknown>> => (isRecord(current) ? current : {}),
    [current],
  );
  const fieldDefinitions = props.fields;
  // Option lists copy and sort the observed values: rebuilt only when the
  // stats, the filter or the field labels change, not on every render.
  const groups = useMemo(() => {
    const kindsSelected = readList(view["kinds"]);
    const selectedFields = readFields(view["fields"]);
    const fieldIds = new Set([
      ...stats.fields.keys(),
      ...(fieldDefinitions ?? []).map((field) => field.id),
      ...selectedFields.map((field) => field.id),
    ]);
    return {
      kinds: {
        selected: kindsSelected,
        options: optionsOf(new Map(KINDS.map((kind) => [kind, stats.kinds[kind]])), kindsSelected),
      },
      lists: LISTS.map((property) => {
        const selected = readList(view[property]);
        return { property, selected, options: optionsOf(stats[property], selected) };
      }),
      selectedFields,
      fields: [...fieldIds].map((id) => {
        const selected = selectedFields.find((field) => field.id === id)?.values;
        return {
          id,
          label: fieldDefinitions?.find((field) => field.id === id)?.label ?? id,
          selected,
          options: optionsOf(stats.fields.get(id), selected),
        };
      }),
    };
  }, [stats, view, fieldDefinitions]);

  // Stable, so a host control that keeps it reaches the latest callback.
  const change = useStableCallback((next: TraceFilter): void => {
    if (!controlled) setInternal(next);
    onFilterChange?.(next);
  });

  /** Sets properties of the current filter; `undefined` removes one. */
  function set(changes: Readonly<Record<string, unknown>>): void {
    const next: Record<string, unknown> = { ...view };
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    change(next as TraceFilter);
  }

  const range = isRecord(view["timeRange"]) ? view["timeRange"] : {};
  const from = readString(range["from"]);
  const to = readString(range["to"]);
  function setBound(bound: "from" | "to", text: string): void {
    const next = { from, to, [bound]: text };
    const kept = {
      ...(next.from !== "" && { from: next.from }),
      ...(next.to !== "" && { to: next.to }),
    };
    set({ timeRange: Object.keys(kept).length === 0 ? undefined : kept });
  }

  function setField(id: string, values: Value[] | undefined): void {
    const next = groups.selectedFields.filter((field) => field.id !== id);
    if (values !== undefined) next.push({ id, values });
    set({ fields: next.length === 0 ? undefined : next });
  }

  const controls = useUniqueSlots(props.filterControls, "filter control");
  const messageIds = (readList(view["messageIds"]) ?? []).filter((id) => typeof id === "string");
  const text = readString(view["text"]);
  const controlError = <p className="oot-filter-group__error">{allStrings.filterControlError}</p>;

  return (
    <StringsContext.Provider value={allStrings}>
      <div
        role="group"
        aria-label={strings.panelLabel}
        className={props.className === undefined ? "oot-filter" : `oot-filter ${props.className}`}
      >
        {error !== null && (
          <p role="alert" className="oot-filter-error">
            {strings.invalid(error)}
          </p>
        )}
        <button type="button" className="oot-filter-reset" onClick={() => change({})}>
          {strings.reset}
        </button>
        <Group
          legend={strings.search}
          onClear={
            view["text"] === undefined && view["searchPayloads"] === undefined
              ? undefined
              : () => set({ text: undefined, searchPayloads: undefined })
          }
        >
          <label className="oot-filter-field">
            {strings.text}
            <input
              type="search"
              value={text}
              onChange={(event) => set({ text: event.currentTarget.value || undefined })}
            />
          </label>
          {props.payloadSearch === true && (
            <label className="oot-filter-option">
              <input
                type="checkbox"
                checked={view["searchPayloads"] === true}
                onChange={(event) =>
                  set({ searchPayloads: event.currentTarget.checked || undefined })
                }
              />
              {strings.searchPayloads}
            </label>
          )}
        </Group>
        <ValueGroup
          legend={strings.kinds}
          options={groups.kinds.options}
          selected={groups.kinds.selected}
          onChange={(kinds) => set({ kinds })}
          display={(kind) => strings.kindNames[String(kind)] ?? String(kind)}
        />
        <Group
          legend={strings.timeRange}
          onClear={
            view["timeRange"] === undefined ? undefined : () => set({ timeRange: undefined })
          }
        >
          <DraftInput
            label={strings.from}
            value={from}
            onCommit={(value) => setBound("from", value)}
          />
          <DraftInput label={strings.to} value={to} onCommit={(value) => setBound("to", value)} />
        </Group>
        {groups.lists.map(({ property, selected, options }) => (
          <ValueGroup
            key={property}
            legend={strings[property]}
            options={options}
            selected={selected}
            onChange={(values) => set({ [property]: values })}
          />
        ))}
        {groups.fields.map(({ id, label, selected, options }) => (
          <ValueGroup
            key={id}
            legend={label}
            options={options}
            selected={selected}
            onChange={(values) => setField(id, values)}
          />
        ))}
        <Group
          legend={strings.messageIds}
          onClear={
            view["messageIds"] === undefined ? undefined : () => set({ messageIds: undefined })
          }
        >
          <DraftInput
            label={strings.messageIds}
            value={messageIds.join(", ")}
            onCommit={(value) => {
              const ids = value.split(/[\s,]+/).filter((id) => id !== "");
              set({ messageIds: ids.length === 0 ? undefined : ids });
            }}
          />
        </Group>
        {controls.map((control) => (
          <fieldset key={control.id} className="oot-filter-group oot-filter-group--host">
            <legend className="oot-filter-legend">{control.label}</legend>
            <ResetBoundary fallback={controlError} resetKeys={[control]}>
              <SlotContent slot={control} context={{ filter: current, setFilter: change }} />
            </ResetBoundary>
          </fieldset>
        ))}
      </div>
    </StringsContext.Provider>
  );
}
