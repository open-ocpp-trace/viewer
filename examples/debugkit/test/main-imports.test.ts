import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

// The browser has no `Buffer`; buffer-shim.test.ts proves the shim makes
// DebugKit parse without one. This checks the entry point evaluates the
// shim before any other module, so nothing can reach DebugKit first.

const MAIN = readFileSync(join(import.meta.dirname, "../src/main.tsx"), "utf8");

/** The static import specifiers of `source`, in evaluation order. */
function staticImports(source: string): string[] {
  const pattern = /^\s*import\b[^;"']*?["']([^"']+)["']/gm;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("the example's entry point", () => {
  it("imports the Buffer shim before anything else", () => {
    const imports = staticImports(MAIN);
    expect(imports.length).toBeGreaterThan(1);
    expect(imports[0]).toBe("./buffer-shim.ts");
  });
});
