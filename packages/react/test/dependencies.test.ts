import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const ROOT = join(import.meta.dirname, "..");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<
  string,
  Readonly<Record<string, string>> | undefined
>;

/** The packages the viewer may depend on: no host (DebugKit, simulator, gateway) code. */
const ALLOWED = [
  "@open-ocpp-trace/jsonl",
  "@open-ocpp-trace/viewer-core",
  "@tanstack/react-virtual",
  "react",
  "react-dom",
];

/** The import specifiers of `source`: static, side-effect, re-export and dynamic. */
function specifiers(source: string): string[] {
  const pattern =
    /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gm;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

/** The package an import specifier names, `undefined` for a relative one. */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

describe("the dependency graph of viewer-react", () => {
  it("declares only allowed runtime and peer dependencies", () => {
    const declared = [
      ...Object.keys(MANIFEST["dependencies"] ?? {}),
      ...Object.keys(MANIFEST["peerDependencies"] ?? {}),
    ];
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((name) => !ALLOWED.includes(name))).toEqual([]);
  });

  it("imports only allowed packages from its sources", () => {
    const files = readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.(ts|tsx)$/.test(file),
    );
    const imported = files.flatMap((file) =>
      specifiers(readFileSync(join(ROOT, "src", file), "utf8")).map((specifier) => ({
        file,
        specifier,
      })),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(imported.some(({ specifier }) => packageOf(specifier) !== undefined)).toBe(true);
    const unexpected = imported.filter(({ specifier }) => {
      const name = packageOf(specifier);
      return name !== undefined && !ALLOWED.includes(name);
    });
    expect(unexpected).toEqual([]);
  });
});
