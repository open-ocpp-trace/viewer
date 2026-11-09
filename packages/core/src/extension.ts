import type { EntryId, ViewerEntry } from "./entry.ts";

/** The entry the user selected, or none. */
export interface ViewerSelection {
  readonly entryId: EntryId | null;
}

/**
 * An extra column, described by value only: hosts render the value
 * themselves, so the contract stays framework-neutral.
 */
export interface ColumnDefinition {
  readonly id: string;
  readonly label: string;
  value(entry: ViewerEntry): string | number | boolean | undefined;
}

/** An extra field entries can be filtered on, by the values it yields. */
export interface FilterFieldDefinition {
  readonly id: string;
  readonly label: string;
  values(entry: ViewerEntry): readonly string[];
}
