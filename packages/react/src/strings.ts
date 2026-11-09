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
  toolbar: {
    /** A toggle button: its pressed state tells whether the store is paused. */
    pause: "Pause",
    /** The number of entries held back while paused. */
    pending: (count: number): string => `${count} pending`,
    /** A toggle button: its pressed state tells whether the list follows. */
    follow: "Follow latest",
  },
  /** The text of a gap row; the count and the reason are omitted when unknown. */
  gap(missedCount: number | null, reason: string | null): string {
    const missed =
      missedCount === null
        ? ""
        : `: ${missedCount} ${missedCount === 1 ? "entry" : "entries"} missed`;
    return `Gap${missed}${reason === null ? "" : ` (${reason})`}`;
  },
  inspector: {
    label: "Entry details",
    empty: "No entry selected",
    gone: "This entry is no longer available",
    fields: {
      messageType: "Type",
      action: "Action",
      direction: "Direction",
      messageId: "Message ID",
      chargePoint: "Charge point",
      connector: "Connector",
      ocppVersion: "OCPP version",
      transport: "Transport",
      timestamp: "Timestamp",
      receivedAt: "Received at",
      reason: "Reason",
      errorCode: "Error code",
      errorDescription: "Error description",
      tenant: "Tenant",
      source: "Source",
      session: "Session",
      conversation: "Conversation",
      deliveries: "Deliveries",
    },
    /** Block titles, also the accessible names of the blocks. */
    blocks: {
      payload: "Payload",
      raw: "Raw frame",
      error: "Error details",
      meta: "Meta",
      custom: "Custom metadata",
    },
    showMore: "Show more",
    totalSize: (chars: number): string => `${chars} characters in total`,
    copy: (block: string): string => `Copy ${block}`,
    rawHidden: "The raw frame is hidden: it may contain sensitive fields",
    goToResponse: "Go to response",
    goToCall: "Go to CALL",
    noMatchingCall: "No matching CALL",
    candidate: (position: number): string => `Candidate ${position}`,
    source: (id: string, label: string | null): string =>
      label === null ? id : `${label} (${id})`,
    delivery(
      target: string,
      role: string | null,
      status: string,
      reason: string | null,
      updatedAt: string | null,
    ): string {
      const by = role === null ? "" : ` (${role})`;
      const why = reason === null ? "" : ` — ${reason}`;
      return `${target}${by}: ${status}${why}${updatedAt === null ? "" : ` at ${updatedAt}`}`;
    },
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
