// Guards for untrusted host data (filters, entries): they never throw, so
// rendering does not fail on malformed input.

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a property of untrusted data without throwing; `undefined` for a non-object. */
export function readProp(value: unknown, key: string): unknown {
  try {
    return typeof value === "object" && value !== null
      ? (value as Readonly<Record<string, unknown>>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

/** The value when it is a string, else `""`. */
export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
