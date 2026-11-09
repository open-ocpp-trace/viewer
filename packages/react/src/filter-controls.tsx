import { useState, type ReactElement, type ReactNode } from "react";

import { useStrings } from "./strings-context.ts";

/** A value a filter list selects; `null` selects the absent value. */
export type Value = string | number | null;

// The filter may be malformed host data: the panel reads it defensively, so
// rendering never throws before the engine has rejected it.

export function readList(value: unknown): readonly Value[] | undefined {
  return Array.isArray(value) ? (value as Value[]) : undefined;
}

function compare(a: Value, b: Value): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  // Code-unit order: total and locale-independent.
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** The observed values and their counts, plus the selected ones no longer observed. */
export function optionsOf(
  counts: ReadonlyMap<Value, number> | undefined,
  selected: readonly Value[] | undefined,
): (readonly [Value, number])[] {
  const all = new Map<Value, number>(counts);
  for (const value of selected ?? []) if (!all.has(value)) all.set(value, 0);
  return [...all].sort(([a], [b]) => compare(a, b));
}

export function Group(props: {
  legend: string;
  /** Undefined when the group constrains nothing. */
  onClear: (() => void) | undefined;
  children: ReactNode;
}): ReactElement {
  const strings = useStrings().filter;
  return (
    <fieldset className="oot-filter-group">
      <legend className="oot-filter-legend">{props.legend}</legend>
      {props.children}
      <button
        type="button"
        className="oot-filter-clear"
        aria-label={strings.clearGroup(props.legend)}
        disabled={props.onClear === undefined}
        onClick={props.onClear}
      >
        {strings.clear}
      </button>
    </fieldset>
  );
}

/**
 * A checkbox per value. Unchecking the last value removes the property, as
 * an empty list would match nothing.
 */
export function ValueGroup(props: {
  legend: string;
  options: readonly (readonly [Value, number])[];
  selected: readonly Value[] | undefined;
  onChange: (next: Value[] | undefined) => void;
  display?: (value: Value) => string;
}): ReactElement {
  const { selected = [], onChange } = props;
  const strings = useStrings().filter;
  const display = props.display ?? ((value) => String(value));
  return (
    <Group
      legend={props.legend}
      onClear={props.selected === undefined ? undefined : () => onChange(undefined)}
    >
      <div className="oot-filter-options">
        {props.options.map(([value, count]) => {
          const checked = selected.includes(value);
          const next = checked ? selected.filter((item) => item !== value) : [...selected, value];
          return (
            // Keyed by value, typed so null, "null" and 1, "1" differ: a
            // focused checkbox keeps its value when a new one sorts before it.
            <label
              key={`${value === null ? "null" : typeof value}:${String(value)}`}
              className="oot-filter-option"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(next.length === 0 ? undefined : next)}
              />
              {strings.option(value === null ? strings.none : display(value), count)}
            </label>
          );
        })}
      </div>
    </Group>
  );
}

/**
 * A text input committing its draft on blur or Enter, so a half-typed value
 * does not re-filter on every key. A new committed `value` replaces the draft.
 */
export function DraftInput(props: {
  label: string;
  value: string;
  onCommit: (text: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState(props.value);
  const [shown, setShown] = useState(props.value);
  if (shown !== props.value) {
    setShown(props.value);
    setDraft(props.value);
  }
  const commit = (): void => {
    if (draft !== props.value) props.onCommit(draft.trim());
  };
  return (
    <label className="oot-filter-field">
      {props.label}
      <input
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </label>
  );
}
