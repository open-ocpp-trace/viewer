import type { ViewerEntry } from "./entry.ts";
import type { FilterFieldDefinition } from "./extension.ts";

/**
 * Which entries a `FilterEngine` lists: plain, serializable data.
 *
 * - Properties combine with AND, the values of one list with OR. An omitted
 *   (or `undefined`) property constrains nothing; an empty list matches no
 *   entry. `{}` matches every entry.
 * - `null` in a list selects the entries lacking that value. A value of the
 *   wrong runtime type in a record (a string `connectorId`, a non-string
 *   `action`, a negative or fractional connector) is absent too. `""` is a
 *   value like any other, never the absent marker.
 * - Gaps are preserved: a gap entry passes every property, `text` included,
 *   except `kinds`, so a filtered view still shows where entries may be
 *   missing.
 * - Unparsed entries stay identifiable: they keep `kind: "unparsed"` and
 *   lack every record field, so `messageTypes: ["CALL"]` hides them and
 *   `messageTypes: ["CALL", null]` keeps them.
 *
 * Values are read from an entry as follows (see
 * `docs/adr/0003-filtering.md`): the charge point is
 * `record.chargePointId ?? metadata.chargePointId` for a trace,
 * `metadata.chargePointId` otherwise; the action is
 * `record.action ?? correlator.get(id).action`; connector, OCPP version,
 * message type and message id come from the record of a trace only; the
 * direction from the record or the unparsed entry.
 *
 * `FilterEngine.setFilter` rejects a malformed filter (unknown
 * property, non-array list, item of the wrong type, unparsable time bound,
 * unknown field id) with a `RangeError`.
 */
export interface TraceFilter {
  readonly kinds?: readonly ViewerEntry["kind"][];
  /**
   * RFC 3339 bounds, compared as instants: `from` inclusive, `to`
   * exclusive. An entry's time is `record.timestamp` for a trace, its own
   * `timestamp` otherwise, else `receivedAt`; an entry without a parsable
   * time is outside any range with a bound.
   */
  readonly timeRange?: { readonly from?: string; readonly to?: string };
  readonly chargePointIds?: readonly (string | null)[];
  /** Integers >= 0. */
  readonly connectorIds?: readonly (number | null)[];
  readonly ocppVersions?: readonly (string | null)[];
  readonly directions?: readonly (string | null)[];
  readonly messageTypes?: readonly (string | null)[];
  /** The effective action, derived by the engine's correlator for responses. */
  readonly actions?: readonly (string | null)[];
  /** Exact match. */
  readonly messageIds?: readonly (string | null)[];
  readonly sessionIds?: readonly (string | null)[];
  readonly tenants?: readonly (string | null)[];
  /** `metadata.source.id`. */
  readonly sourceIds?: readonly (string | null)[];
  /**
   * An entry matches when any of its delivery statuses is selected, or when
   * `null` is selected and it has no delivery.
   */
  readonly deliveryStatuses?: readonly (string | null)[];
  /**
   * Producer-defined fields, by {@link FilterFieldDefinition.id}. An entry
   * for which `values` returns no string has the field absent.
   */
  readonly fields?: readonly {
    readonly id: string;
    readonly values: readonly (string | null)[];
  }[];
  /**
   * Trimmed, case-insensitive substring searched in metadata only: entry
   * id, message id, effective action and charge point, OCPP version,
   * message type, direction, CALLERROR `error.code`, session, tenant,
   * conversation, source id and label, delivery targets and statuses, the
   * unparsed `reason` and the values of declared producer fields. Payloads,
   * raw frames, `record.meta`, `metadata.custom` and the error description
   * and details are never read by default, as they may hold secrets. Blank
   * text constrains nothing; gaps are kept whatever the text.
   */
  readonly text?: string;
  /**
   * Also searches `record.payload`, `record.raw`, the unparsed `raw` and
   * the error description and details. Allowed only on an engine created
   * with `payloadSearch: true`, else `setFilter` throws a `RangeError`. The
   * scan is capped per entry (64 Ki characters, depth 32): matches beyond
   * the cap are missed. `record.meta` and `metadata.custom` stay excluded.
   */
  readonly searchPayloads?: boolean;
}

/** Properties holding single string values, read by `filter-match.ts`. */
export type StringProperty =
  | "chargePointIds"
  | "ocppVersions"
  | "directions"
  | "messageTypes"
  | "actions"
  | "messageIds"
  | "sessionIds"
  | "tenants"
  | "sourceIds";

const STRING_PROPERTIES: readonly StringProperty[] = [
  "chargePointIds",
  "ocppVersions",
  "directions",
  "messageTypes",
  "actions",
  "messageIds",
  "sessionIds",
  "tenants",
  "sourceIds",
];

const KNOWN_PROPERTIES: ReadonlySet<string> = new Set([
  ...STRING_PROPERTIES,
  "kinds",
  "timeRange",
  "connectorIds",
  "deliveryStatuses",
  "fields",
  "text",
  "searchPayloads",
]);

const KINDS: ReadonlySet<string> = new Set(["trace", "unparsed", "gap"]);

/** A selected value set; `null` selects the absent value. */
export type Selection<T> = ReadonlySet<T | null>;

/** A validated {@link TraceFilter}, with sets in place of lists. */
export interface CompiledFilter {
  /** A frozen copy of the filter it was compiled from. */
  readonly filter: TraceFilter;
  readonly kinds: ReadonlySet<string> | undefined;
  /** Epoch milliseconds; both undefined when the range has no bound. */
  readonly from: number | undefined;
  readonly to: number | undefined;
  readonly strings: readonly {
    readonly property: StringProperty;
    readonly values: Selection<string>;
  }[];
  readonly connectorIds: Selection<number> | undefined;
  readonly deliveryStatuses: Selection<string> | undefined;
  readonly fields: readonly {
    readonly definition: FilterFieldDefinition;
    readonly values: Selection<string>;
  }[];
  /** Trimmed and lower-cased; undefined when blank. */
  readonly text: string | undefined;
  /** The text is also searched in payloads. */
  readonly payloads: boolean;
}

function fail(message: string): never {
  throw new RangeError(`invalid trace filter: ${message}`);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function list(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${name} is not an array`);
  return value;
}

function strings(value: unknown, name: string): readonly (string | null)[] {
  const items = list(value, name);
  for (const item of items) {
    if (item !== null && typeof item !== "string") fail(`${name} holds a non-string value`);
  }
  return Object.freeze([...(items as (string | null)[])]);
}

function bound(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${name} is not a string`);
  const time = Date.parse(value);
  if (Number.isNaN(time)) fail(`${name} is not a date-time`);
  return time;
}

/** Producer field definitions by id; a duplicate id throws a `RangeError`. */
export function fieldMap(
  fields: readonly FilterFieldDefinition[] | undefined,
): ReadonlyMap<string, FilterFieldDefinition> {
  const map = new Map<string, FilterFieldDefinition>();
  for (const field of fields ?? []) {
    if (map.has(field.id)) {
      throw new RangeError(`duplicate filter field id ${JSON.stringify(field.id)}`);
    }
    map.set(field.id, field);
  }
  return map;
}

/**
 * Validates `filter` against the declared producer fields and compiles it.
 * Throws a `RangeError` on malformed input, leaving no state behind.
 * `payloadSearch` is the engine's capability: without it, a filter asking
 * for `searchPayloads` is rejected.
 */
export function compileFilter(
  filter: TraceFilter,
  fields: ReadonlyMap<string, FilterFieldDefinition>,
  payloadSearch = false,
): CompiledFilter {
  if (!isRecord(filter)) fail("not an object");
  const input = filter as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(input)) {
    if (!KNOWN_PROPERTIES.has(key)) fail(`unknown property ${JSON.stringify(key)}`);
  }
  const copy: Record<string, unknown> = {};

  let kinds: ReadonlySet<string> | undefined;
  if (input["kinds"] !== undefined) {
    const items = strings(input["kinds"], "kinds");
    for (const kind of items) if (kind === null || !KINDS.has(kind)) fail("unknown kind");
    kinds = new Set(items as string[]);
    copy["kinds"] = items;
  }

  let from: number | undefined;
  let to: number | undefined;
  if (input["timeRange"] !== undefined) {
    const range = input["timeRange"];
    if (!isRecord(range)) fail("timeRange is not an object");
    from = bound(range["from"], "timeRange.from");
    to = bound(range["to"], "timeRange.to");
    copy["timeRange"] = Object.freeze({
      ...(from !== undefined && { from: range["from"] }),
      ...(to !== undefined && { to: range["to"] }),
    });
  }

  const selected: CompiledFilter["strings"][number][] = [];
  for (const property of STRING_PROPERTIES) {
    if (input[property] === undefined) continue;
    const items = strings(input[property], property);
    selected.push({ property, values: new Set(items) });
    copy[property] = items;
  }

  let connectorIds: Selection<number> | undefined;
  if (input["connectorIds"] !== undefined) {
    const items = list(input["connectorIds"], "connectorIds");
    for (const item of items) {
      if (item !== null && !(Number.isInteger(item) && (item as number) >= 0)) {
        fail("connectorIds holds a value that is not an integer >= 0");
      }
    }
    const frozen = Object.freeze([...(items as (number | null)[])]);
    connectorIds = new Set(frozen);
    copy["connectorIds"] = frozen;
  }

  let deliveryStatuses: Selection<string> | undefined;
  if (input["deliveryStatuses"] !== undefined) {
    const items = strings(input["deliveryStatuses"], "deliveryStatuses");
    deliveryStatuses = new Set(items);
    copy["deliveryStatuses"] = items;
  }

  const compiledFields: CompiledFilter["fields"][number][] = [];
  if (input["fields"] !== undefined) {
    const copies: { readonly id: string; readonly values: readonly (string | null)[] }[] = [];
    for (const item of list(input["fields"], "fields")) {
      if (!isRecord(item) || typeof item["id"] !== "string") fail("a field has no string id");
      const id = item["id"];
      const definition = fields.get(id);
      if (definition === undefined) fail(`unknown field ${JSON.stringify(id)}`);
      const values = strings(item["values"], `field ${JSON.stringify(id)}`);
      compiledFields.push({ definition, values: new Set(values) });
      copies.push(Object.freeze({ id, values }));
    }
    copy["fields"] = Object.freeze(copies);
  }

  let text: string | undefined;
  if (input["text"] !== undefined) {
    if (typeof input["text"] !== "string") fail("text is not a string");
    const trimmed = input["text"].trim().toLowerCase();
    if (trimmed !== "") text = trimmed;
    copy["text"] = input["text"];
  }

  const payloads = input["searchPayloads"];
  if (payloads !== undefined) {
    if (typeof payloads !== "boolean") fail("searchPayloads is not a boolean");
    if (payloads && !payloadSearch) fail("payload search is not enabled on this engine");
    copy["searchPayloads"] = payloads;
  }

  return {
    filter: Object.freeze(copy) as TraceFilter,
    kinds,
    from,
    to,
    strings: selected,
    connectorIds,
    deliveryStatuses,
    fields: compiledFields,
    text,
    payloads: payloads === true,
  };
}
