import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

// DebugKit is a dependency of examples/debugkit only. viewer-react's own
// dependency test allow-lists its imports; this guard covers every package
// under packages/, their manifests and the lockfile, for DebugKit by name.

const REPO = join(import.meta.dirname, "../../..");
const PACKAGES = join(REPO, "packages");
const DEBUGKIT_SCOPE = "@ocpp-debugkit";
const DEBUGKIT = "@ocpp-debugkit/toolkit";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
] as const;

type Manifest = Partial<
  Record<(typeof DEPENDENCY_FIELDS)[number], Readonly<Record<string, string>> | readonly string[]>
>;

const packageDirs = readdirSync(PACKAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

/** The names a manifest declares, in any dependency field. */
function declaredNames(manifest: Manifest): string[] {
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const value = manifest[field];
    if (value === undefined) return [];
    return Array.isArray(value) ? [...value] : Object.keys(value);
  });
}

/** bun.lock is JSON with trailing commas. */
function readLockfile(): { workspaces: Record<string, Manifest> } {
  const text = readFileSync(join(REPO, "bun.lock"), "utf8");
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")) as {
    workspaces: Record<string, Manifest>;
  };
}

describe("the viewer packages and DebugKit", () => {
  it("declare no DebugKit dependency in any package manifest", () => {
    expect(packageDirs.length).toBeGreaterThanOrEqual(3);
    const offending = packageDirs.flatMap((dir) => {
      const manifest = JSON.parse(
        readFileSync(join(PACKAGES, dir, "package.json"), "utf8"),
      ) as Manifest;
      return declaredNames(manifest)
        .filter((name) => name.startsWith(`${DEBUGKIT_SCOPE}/`))
        .map((name) => `packages/${dir}: ${name}`);
    });
    expect(offending).toEqual([]);
  });

  it("reference DebugKit nowhere in their sources", () => {
    const files = packageDirs.flatMap((dir) =>
      readdirSync(join(PACKAGES, dir, "src"), { recursive: true, encoding: "utf8" })
        .map((file) => join(dir, "src", file))
        .filter((file) => /\.\w+$/.test(file)),
    );
    expect(files.length).toBeGreaterThan(0);
    const offending = files.filter((file) =>
      readFileSync(join(PACKAGES, file), "utf8").includes(DEBUGKIT_SCOPE),
    );
    expect(offending).toEqual([]);
  });

  it("leave DebugKit declared by the debugkit example workspace only", () => {
    const { workspaces } = readLockfile();
    expect(Object.keys(workspaces)).toContain("packages/core");
    const declaring = Object.entries(workspaces)
      .filter(([, manifest]) => declaredNames(manifest).includes(DEBUGKIT))
      .map(([path]) => path);
    expect(declaring).toEqual(["examples/debugkit"]);
  });
});
