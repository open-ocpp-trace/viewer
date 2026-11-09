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
  jumpToLatest: "Jump to latest",
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
    clear: "Clear",
    /** The accessible name of a group's clear button. */
    clearGroup: (legend: string): string => `Clear ${legend}`,
    /** The label of a checkbox: an observed value and its number of entries. */
    option: (value: string, count: number): string => `${value} (${count})`,
    none: "(none)",
    kinds: "Kinds",
    kindNames: { trace: "Traces", unparsed: "Unparsed", gap: "Gaps" } as Readonly<
      Record<string, string>
    >,
    timeRange: "Time range",
    from: "From",
    to: "To",
    chargePointIds: "Charge points",
    connectorIds: "Connectors",
    ocppVersions: "OCPP versions",
    directions: "Directions",
    messageTypes: "Message types",
    actions: "Actions",
    sessionIds: "Sessions",
    tenants: "Tenants",
    sourceIds: "Sources",
    deliveryStatuses: "Delivery statuses",
    messageIds: "Message IDs",
    search: "Search",
    text: "Text",
    searchPayloads: "Search payloads",
  },
};

/** The type of {@link defaultStrings}. */
export type Strings = typeof defaultStrings;
