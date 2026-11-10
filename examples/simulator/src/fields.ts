import type {
  ColumnDefinition,
  FilterFieldDefinition,
  ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

/**
 * The simulator's records never carry `connectorId` (its converter does not
 * derive one), so the built-in connector filter only offers "(none)". The
 * page reads the connector the payload names instead, as a host field: the
 * record itself is left untouched.
 */
export function payloadConnector(entry: ViewerEntry): number | undefined {
  if (entry.kind !== "trace") return undefined;
  const payload: unknown = entry.record.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)["connectorId"];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export const CONNECTOR_FIELD: FilterFieldDefinition = {
  id: "payloadConnector",
  label: "Connector (payload)",
  values: (entry) => {
    const connector = payloadConnector(entry);
    return connector === undefined ? [] : [String(connector)];
  },
};

export function connectorColumn(label: string): ColumnDefinition {
  return { id: "payloadConnector", label, value: payloadConnector };
}

/** The inbound validation the simulator attached to a CSMS CALL, if any. */
export interface InboundValidation {
  readonly mode: string;
  readonly errorCode: string;
  readonly description: string;
}

export function validationOf(entry: ViewerEntry): InboundValidation | undefined {
  if (entry.kind !== "trace") return undefined;
  const value: unknown = entry.record.meta?.["validation"];
  if (typeof value !== "object" || value === null) return undefined;
  const { mode, errorCode, description } = value as Record<string, unknown>;
  if (typeof mode !== "string" || typeof errorCode !== "string") return undefined;
  return { mode, errorCode, description: typeof description === "string" ? description : "" };
}
