import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import config from "../vite.config.ts";

const PACKAGE = join(import.meta.dirname, "..");
const NOTICES = readFileSync(join(PACKAGE, "THIRD_PARTY_NOTICES.md"), "utf8");

interface Notice {
  readonly name: string;
  readonly version: string | undefined;
  readonly license: string | undefined;
  readonly text: string;
}

/** The `## <name>` sections of the notices, with their version and license lines. */
function notices(): Notice[] {
  return NOTICES.split(/^## /m)
    .slice(1)
    .map((section) => {
      const [name = "", ...rest] = section.split("\n");
      const body = rest.join("\n");
      return {
        name: name.trim(),
        version: /^- Version: (\S+)$/m.exec(body)?.[1],
        license: /^- License: (\S+)$/m.exec(body)?.[1],
        text: /^```text\n([\s\S]*?)^```$/m.exec(body)?.[1] ?? "",
      };
    });
}

/**
 * Where the pack finds each bundled package: the workspace package that
 * depends on it, or the bundled package that does.
 */
const IMPORTED_FROM: Readonly<Record<string, string>> = {
  react: PACKAGE,
  "react-dom": PACKAGE,
  scheduler: "react-dom",
  "@tanstack/react-virtual": join(PACKAGE, "..", "react"),
  "@tanstack/virtual-core": "@tanstack/react-virtual",
  "@open-ocpp-trace/core": join(PACKAGE, "..", "core"),
  "@open-ocpp-trace/jsonl": join(PACKAGE, "..", "react"),
};

/** The directory of the installed copy of a bundled package. */
function installedDirectory(name: string): string {
  const from = IMPORTED_FROM[name];
  if (from === undefined) throw new Error(`${name} has no entry in IMPORTED_FROM`);
  const base = from in IMPORTED_FROM ? installedDirectory(from) : from;
  return dirname(realpathSync(createRequire(join(base, "x")).resolve(`${name}/package.json`)));
}

/** The `pack.deps.onlyBundle` list of vite.config.ts. */
function onlyBundle(): readonly string[] {
  const pack = config.pack;
  const deps = Array.isArray(pack) ? undefined : pack?.deps;
  const list = deps?.onlyBundle;
  if (!Array.isArray(list)) return [];
  return list.filter((entry): entry is string => typeof entry === "string");
}

describe("THIRD_PARTY_NOTICES.md", () => {
  it("lists exactly the packages the pack bundles", () => {
    const bundled = onlyBundle();
    expect(bundled.length).toBeGreaterThan(0);
    expect(
      notices()
        .map((notice) => notice.name)
        .sort(),
    ).toEqual([...bundled].sort());
  });

  it("gives the installed version, license and license text of each package", () => {
    for (const notice of notices()) {
      const directory = installedDirectory(notice.name);
      const installed = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        version: string;
        license: string;
      };
      expect({ name: notice.name, version: notice.version, license: notice.license }).toEqual({
        name: notice.name,
        version: installed.version,
        license: installed.license,
      });
      const license = readFileSync(join(directory, "LICENSE"), "utf8");
      expect(notice.text.trim(), notice.name).toBe(license.trim());
    }
  });

  it("is published with the package", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      files: string[];
    };
    expect(manifest.files).toContain("THIRD_PARTY_NOTICES.md");
  });
});
