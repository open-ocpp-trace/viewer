import type { Correlator } from "./correlation.ts";
import type { ViewerEntry } from "./entry.ts";
import type { FilterFieldDefinition } from "./extension.ts";
import {
  connectorValue,
  deliveryStatuses,
  fieldValues,
  type MatchContext,
  stringValue,
} from "./filter-extract.ts";
import { fieldMap, type StringProperty } from "./filter-model.ts";

/**
 * Observed values and their counts over a set of entries, read with the
 * same extractors as `TraceFilter`, so every key is a value a filter can
 * select. A map key is an observed value and its count the number of
 * entries carrying it; `null` counts the entries lacking the value. A
 * multi-valued property (delivery statuses, producer fields) counts an
 * entry once per distinct value, under `null` when it has none. Gaps and
 * unparsed entries count in `total` and `kinds`, and under `null` for every
 * value they lack. No key has a count of 0. Message ids are not counted:
 * nearly every entry has its own, so the map would grow with the buffer.
 */
export interface TraceStats {
  readonly total: number;
  readonly kinds: { readonly trace: number; readonly unparsed: number; readonly gap: number };
  readonly chargePointIds: ReadonlyMap<string | null, number>;
  readonly connectorIds: ReadonlyMap<number | null, number>;
  readonly ocppVersions: ReadonlyMap<string | null, number>;
  readonly directions: ReadonlyMap<string | null, number>;
  readonly messageTypes: ReadonlyMap<string | null, number>;
  /** The effective action, derived by the correlator for responses. */
  readonly actions: ReadonlyMap<string | null, number>;
  readonly sessionIds: ReadonlyMap<string | null, number>;
  readonly tenants: ReadonlyMap<string | null, number>;
  readonly sourceIds: ReadonlyMap<string | null, number>;
  readonly deliveryStatuses: ReadonlyMap<string | null, number>;
  /** Every declared producer field, by id, with the values it yielded. */
  readonly fields: ReadonlyMap<string, ReadonlyMap<string | null, number>>;
}

/** Single-valued string properties counted, in {@link TraceStats} order. */
const STRINGS = [
  "chargePointIds",
  "ocppVersions",
  "directions",
  "messageTypes",
  "actions",
  "sessionIds",
  "tenants",
  "sourceIds",
] as const satisfies readonly StringProperty[];

const CONNECTORS = STRINGS.length;
const DELIVERIES = CONNECTORS + 1;
const FIELDS = DELIVERIES + 1;

type Key = string | number | null;

/**
 * The counted values of one entry: its kind, and per counted property the
 * distinct keys it carries (`[null]` when absent), laid out as the
 * {@link STRINGS}, the connector, the delivery statuses, then the producer
 * fields in context order. Multi-valued keys are sorted, so a reordering
 * compares equal in {@link sameValues}.
 */
export interface EntryValues {
  readonly kind: ViewerEntry["kind"];
  readonly keys: readonly (readonly Key[])[];
}

function orNull(values: readonly string[]): readonly (string | null)[] {
  // Code-unit order: total and locale-independent.
  return values.length === 0 ? [null] : [...values].sort();
}

/** Reads the counted values of `entry`; never throws on untrusted data. */
export function extractValues(entry: ViewerEntry, ctx: MatchContext): EntryValues {
  const keys: (readonly Key[])[] = STRINGS.map((property) => [stringValue(entry, property, ctx)]);
  keys.push([connectorValue(entry)], orNull(deliveryStatuses(entry)));
  for (const definition of ctx.fields.values()) keys.push(orNull(fieldValues(entry, definition)));
  return { kind: entry.kind, keys };
}

/** Whether two extractions count the same. */
export function sameValues(a: EntryValues, b: EntryValues): boolean {
  return (
    a.kind === b.kind &&
    a.keys.every((keys, index) => {
      const other = b.keys[index]!;
      return keys.length === other.length && keys.every((key, at) => key === other[at]);
    })
  );
}

/** Mutable counts, the state behind {@link computeStats} and the engine. */
export interface StatsCounter {
  add(values: EntryValues): void;
  remove(values: EntryValues): void;
  /** A detached copy: later adds and removes do not change it. */
  snapshot(): TraceStats;
}

/** A counter for the producer fields `fieldIds`, in context order. */
export function createStatsCounter(fieldIds: readonly string[]): StatsCounter {
  let total = 0;
  const kinds = { trace: 0, unparsed: 0, gap: 0 };
  const maps: Map<Key, number>[] = Array.from(
    { length: FIELDS + fieldIds.length },
    () => new Map(),
  );

  function count(values: EntryValues, delta: 1 | -1): void {
    total += delta;
    if (values.kind === "trace" || values.kind === "unparsed" || values.kind === "gap") {
      kinds[values.kind] += delta;
    }
    values.keys.forEach((keys, index) => {
      const map = maps[index]!;
      for (const key of keys) {
        const next = (map.get(key) ?? 0) + delta;
        if (next === 0) map.delete(key);
        else map.set(key, next);
      }
    });
  }

  return {
    add: (values) => count(values, 1),
    remove: (values) => count(values, -1),
    snapshot() {
      const copy = (index: number): Map<never, number> =>
        new Map(maps[index]) as Map<never, number>;
      const [
        chargePointIds,
        ocppVersions,
        directions,
        messageTypes,
        actions,
        sessionIds,
        tenants,
        sourceIds,
      ] = STRINGS.map((_, index) => copy(index));
      return Object.freeze({
        total,
        kinds: Object.freeze({ ...kinds }),
        chargePointIds: chargePointIds!,
        connectorIds: copy(CONNECTORS),
        ocppVersions: ocppVersions!,
        directions: directions!,
        messageTypes: messageTypes!,
        actions: actions!,
        sessionIds: sessionIds!,
        tenants: tenants!,
        sourceIds: sourceIds!,
        deliveryStatuses: copy(DELIVERIES),
        fields: new Map(fieldIds.map((id, index) => [id, copy(FIELDS + index)])),
      });
    },
  };
}

/**
 * Counts the observed values of `entries` (see {@link TraceStats}). Pure: it
 * reads the entries, the producer fields (`values` of each, contained like
 * a filter's) and the correlator's derived actions. Duplicate field ids
 * throw a `RangeError`.
 */
export function computeStats(
  entries: Iterable<ViewerEntry>,
  options?: {
    readonly fields?: readonly FilterFieldDefinition[];
    readonly correlator?: Pick<Correlator, "get">;
  },
): TraceStats {
  const fields = fieldMap(options?.fields);
  const correlator = options?.correlator;
  const ctx: MatchContext = { fields, ...(correlator !== undefined && { correlator }) };
  const counter = createStatsCounter([...fields.keys()]);
  for (const entry of entries) counter.add(extractValues(entry, ctx));
  return counter.snapshot();
}
