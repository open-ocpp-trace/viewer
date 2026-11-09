import type { TraceFilter } from "@open-ocpp-trace/viewer-core";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => b[key] !== undefined && same(a[key], b[key]))
  );
}

/**
 * Whether two filters hold the same plain data. Key order and `undefined`
 * properties are ignored; an empty list differs from an absent one, as it
 * matches nothing. List order counts: a reordered list compares different
 * and costs one redundant `setFilter`, never a stale engine. Never throws,
 * as it runs on host data before the engine validates it.
 */
export function sameFilter(a: TraceFilter, b: TraceFilter): boolean {
  return same(a, b);
}
