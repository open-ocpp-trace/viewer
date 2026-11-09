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

/** Default depth past which containers print as `{…}` / `[…]`. */
export const DEFAULT_MAX_DEPTH = 64;

export interface FormatOptions {
  /** Length of text at which printing stops; may be infinite. */
  readonly maxChars: number;
  /** Containers deeper than this print as `{…}` / `[…]`. */
  readonly maxDepth: number;
  /** Lower-cased property names to redact (see {@link sensitiveKeySet}); null redacts nothing. */
  readonly sensitiveKeys: ReadonlySet<string> | null;
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

const UNREADABLE = "[Unreadable]";

/**
 * Prints `value` as two-space indented JSON-like text, iteratively (no
 * recursion, so any depth is safe) and stopping at `options.maxChars`, so the
 * cost is bounded by the output whatever the input size (an object's keys are
 * listed once). Never throws: values JSON cannot hold, cycles, throwing
 * getters and proxies print as markers.
 */
export function formatValue(value: unknown, options: FormatOptions): Formatted {
  const { maxChars, maxDepth, sensitiveKeys } = options;
  let longestKey = 0;
  for (const key of sensitiveKeys ?? []) longestKey = Math.max(longestKey, key.length);
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
  const isSensitive = (key: string): boolean =>
    sensitiveKeys !== null && key.length <= longestKey && sensitiveKeys.has(key.toLowerCase());

  const open = (item: object, depth: number): Task | null => {
    if (ancestors.has(item)) {
      emit("[Circular]");
      return null;
    }
    const array = Array.isArray(item);
    if (depth >= maxDepth) {
      elided = true;
      emit(array ? "[…]" : "{…}");
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
    else if (typeof item === "symbol") emit("[Symbol]");
    else if (typeof item === "function") emit("[Function]");
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
        emit(UNREADABLE);
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
        emit('"[redacted]"');
        redactedCount++;
        continue;
      }
    }
    let item: unknown;
    try {
      item = (task.value as Readonly<Record<string | number, unknown>>)[key];
    } catch {
      unreadable = true;
      emit(UNREADABLE);
      continue;
    }
    stack.push({ kind: "value", value: item, depth: task.depth + 1 });
  }
  return { text: out.join(""), truncated, elided, unreadable, redactedCount };
}
