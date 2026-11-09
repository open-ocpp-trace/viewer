/**
 * DebugKit 0.4.8 measures its input with `Buffer.byteLength(input, "utf8")`
 * before parsing (its 10 MiB limit). Browsers have no `Buffer`, so without
 * this shim `parseOpenOcppTrace` throws a ReferenceError there; tests run on
 * Node, where `Buffer` exists, and would not show it. The shim provides only
 * `byteLength`, counted with `TextEncoder`, and only when `Buffer` is absent:
 * it is not a Buffer polyfill, and nothing else may rely on it.
 */
interface ByteLengthOnly {
  byteLength(text: string, encoding?: "utf8"): number;
}

const encoder = new TextEncoder();

/** Installs the shim on `globalThis` unless a `Buffer` exists. Idempotent. */
export function installBufferShim(): void {
  const scope = globalThis as { Buffer?: ByteLengthOnly };
  if (scope.Buffer !== undefined) return;
  scope.Buffer = { byteLength: (text) => encoder.encode(text).length };
}

installBufferShim();
