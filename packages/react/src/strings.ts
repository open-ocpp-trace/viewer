/**
 * Every text and accessible label the components show, so a translation
 * replaces this object only. Not exported from the package yet.
 */
export const defaultStrings = {
  listLabel: "Trace entries",
  columns: {
    timestamp: "Timestamp",
    chargePoint: "Charge point",
    connector: "Connector",
    direction: "Direction",
    messageType: "Type",
    action: "Action",
    messageId: "Message ID",
  },
  loading: "Loading entries…",
  empty: "No entries",
  noMatch: "No entries match the filter",
  unparsed: "Unparsed",
  /** The text of a gap row; the count and the reason are omitted when unknown. */
  gap(missedCount: number | null, reason: string | null): string {
    const missed =
      missedCount === null
        ? ""
        : `: ${missedCount} ${missedCount === 1 ? "entry" : "entries"} missed`;
    return `Gap${missed}${reason === null ? "" : ` (${reason})`}`;
  },
  filter: {
    panelLabel: "Filters",
    reset: "Reset",
    /** Followed by the engine's own (English) reason. */
    invalid: "The filter is invalid",
  },
};

/** The type of {@link defaultStrings}. */
export type Strings = typeof defaultStrings;
