import { defaultStrings, type ViewerStrings } from "./strings.ts";

/**
 * Property names whose values the inspector hides by default, matched
 * case-insensitively at any depth: OCPP 1.6 and 2.x authorization tokens and
 * passwords. Value-based secrets (a `SetVariables` value whose variable is
 * `BasicAuthPassword`) are not detected.
 */
export const defaultSensitiveKeys: readonly string[] = Object.freeze([
  "idTag",
  "parentIdTag",
  "idToken",
  "groupIdToken",
  "authorizationKey",
  "password",
  "basicAuthPassword",
]);

/** The lower-cased set {@link formatValue} matches property names against. */
export function sensitiveKeySet(keys: readonly string[]): ReadonlySet<string> {
  return new Set(keys.map((key) => key.toLowerCase()));
}

/**
 * Whether a property name is one of `keys` (see {@link sensitiveKeySet}),
 * case-insensitively; null matches nothing. Shared by the inspector and the
 * redacted export, so both hide the same properties.
 */
export function sensitiveKeyMatcher(keys: ReadonlySet<string> | null): (key: string) => boolean {
  if (keys === null || keys.size === 0) return () => false;
  let longestKey = 0;
  for (const key of keys) longestKey = Math.max(longestKey, key.length);
  return (key) => key.length <= longestKey && keys.has(key.toLowerCase());
}

/** The value written in place of a sensitive property's value, in the export. */
export const REDACTED: string = defaultStrings.inspector.markers.redacted;

/** Longest raw frame checked for sensitive keys; a longer one is hidden or dropped. */
export const RAW_SCAN_MAX = 1_000_000;

/** Default depth past which containers print as `{…}` / `[…]`. */
export const DEFAULT_MAX_DEPTH = 64;

/** The texts printed in place of values that are not shown. */
export type FormatMarkers = ViewerStrings["inspector"]["markers"];

export interface FormatOptions {
  /** Length of text at which printing stops; may be infinite. */
  readonly maxChars: number;
  /** Containers deeper than this print as `{…}` / `[…]`. */
  readonly maxDepth: number;
  /** Lower-cased property names to redact (see {@link sensitiveKeySet}); null redacts nothing. */
  readonly sensitiveKeys: ReadonlySet<string> | null;
  /** The marker texts; the English defaults when absent. */
  readonly markers?: FormatMarkers;
}

export interface Formatted {
  readonly text: string;
  /** Printing stopped at `maxChars`: more chars would print more. */
  readonly truncated: boolean;
  /** A container past `maxDepth` was not looked into. */
  readonly elided: boolean;
  /** A value could not be read (a throwing getter or proxy) and printed `[Unreadable]`. */
  readonly unreadable: boolean;
  /** Properties printed as `"[redacted]"`; those past a truncation or elision are not counted. */
  readonly redactedCount: number;
}

type Task =
  | { readonly kind: "value"; readonly value: unknown; readonly depth: number }
  | {
      readonly kind: "array";
      readonly value: readonly unknown[];
      readonly length: number;
      index: number;
      readonly depth: number;
    }
  | {
      readonly kind: "object";
      readonly value: Readonly<Record<string, unknown>>;
      readonly keys: readonly string[];
      index: number;
      readonly depth: number;
    };

/**
 * Prints `value` as two-space indented JSON-like text, iteratively (no
 * recursion, so any depth is safe) and stopping at `options.maxChars`. The
 * cost is O(maxChars + the keys of each visited object): every object it
 * enters has all its keys listed once, so a 1 000 000-key object costs a
 * listing of 1 000 000 keys on each print. Never throws: values JSON cannot hold, cycles, throwing
 * getters and proxies print as markers.
 */
export function formatValue(value: unknown, options: FormatOptions): Formatted {
  const { maxChars, maxDepth, sensitiveKeys } = options;
  const markers = options.markers ?? defaultStrings.inspector.markers;
  const isSensitive = sensitiveKeyMatcher(sensitiveKeys);
  const out: string[] = [];
  let length = 0;
  let truncated = false;
  let elided = false;
  let unreadable = false;
  let redactedCount = 0;
  const ancestors = new Set<object>();

  const emit = (text: string): void => {
    const room = maxChars - length;
    if (text.length > room) {
      out.push(text.slice(0, room));
      length = maxChars;
      truncated = true;
    } else {
      out.push(text);
      length += text.length;
    }
  };
  // A huge string is sliced before it is escaped, never escaped whole.
  const quote = (text: string): void => {
    const room = maxChars - length;
    emit(JSON.stringify(text.length > room ? text.slice(0, room) : text));
  };
  const indent = (depth: number): string => `\n${"  ".repeat(depth)}`;

  const open = (item: object, depth: number): Task | null => {
    if (ancestors.has(item)) {
      emit(markers.circular);
      return null;
    }
    const array = Array.isArray(item);
    if (depth >= maxDepth) {
      elided = true;
      emit(array ? markers.elidedArray : markers.elidedObject);
      return null;
    }
    if (array) {
      const size = item.length;
      emit(size === 0 ? "[]" : "[");
      return size === 0 ? null : { kind: "array", value: item, length: size, index: 0, depth };
    }
    const keys = Object.keys(item);
    emit(keys.length === 0 ? "{}" : "{");
    if (keys.length === 0) return null;
    return { kind: "object", value: item as Record<string, unknown>, keys, index: 0, depth };
  };

  const printLeaf = (item: unknown): void => {
    if (typeof item === "string") quote(item);
    else if (typeof item === "bigint") emit(`${item}n`);
    else if (typeof item === "symbol") emit(markers.symbol);
    else if (typeof item === "function") emit(markers.function);
    else emit(String(item));
  };

  const stack: Task[] = [{ kind: "value", value, depth: 0 }];
  while (stack.length > 0 && !truncated) {
    const task = stack.pop()!;
    if (task.kind === "value") {
      const item = task.value;
      if (item === null || typeof item !== "object") {
        printLeaf(item);
        continue;
      }
      let container: Task | null;
      try {
        container = open(item, task.depth);
      } catch {
        unreadable = true;
        emit(markers.unreadable);
        continue;
      }
      if (container !== null) {
        ancestors.add(item);
        stack.push(container);
      }
      continue;
    }
    const size = task.kind === "array" ? task.length : task.keys.length;
    if (task.index === size) {
      emit(`${indent(task.depth)}${task.kind === "array" ? "]" : "}"}`);
      ancestors.delete(task.value);
      continue;
    }
    const index = task.index++;
    emit(`${index === 0 ? "" : ","}${indent(task.depth + 1)}`);
    stack.push(task);
    let key: string | number = index;
    if (task.kind === "object") {
      key = task.keys[index]!;
      quote(key);
      emit(": ");
      if (isSensitive(key)) {
        emit(JSON.stringify(markers.redacted));
        redactedCount++;
        continue;
      }
    }
    let item: unknown;
    try {
      item = (task.value as Readonly<Record<string | number, unknown>>)[key];
    } catch {
      unreadable = true;
      emit(markers.unreadable);
      continue;
    }
    stack.push({ kind: "value", value: item, depth: task.depth + 1 });
  }
  return { text: out.join(""), truncated, elided, unreadable, redactedCount };
}
