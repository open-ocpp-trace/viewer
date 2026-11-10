import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

import {
  inspectPackage,
  lockstepProblems,
  SOURCE_CONDITION,
  stripSourceCondition,
  versionConstantProblems,
} from "./release-manifest.ts";

const workspaceManifest = {
  name: "@open-ocpp-trace/viewer-react",
  version: "1.2.3",
  files: ["dist"],
  exports: {
    ".": {
      [SOURCE_CONDITION]: "./src/index.ts",
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    },
    "./styles.css": "./dist/styles.css",
    "./package.json": "./package.json",
  },
  dependencies: {
    "@open-ocpp-trace/jsonl": "0.1.0",
    "@open-ocpp-trace/viewer-core": "1.2.3",
  },
};

const publishedManifest = stripSourceCondition(workspaceManifest);

const publishedFiles = [
  "package.json",
  "README.md",
  "LICENSE",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/styles.css",
  "dist/index-BQK4DWMR.d.ts",
];

describe("stripSourceCondition", () => {
  it("removes the source condition from every export and keeps the others in order", () => {
    expect(publishedManifest.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./styles.css": "./dist/styles.css",
      "./package.json": "./package.json",
    });
    expect(Object.keys(publishedManifest.exports["."])).toEqual(["types", "default"]);
  });

  it("removes the condition from nested conditions", () => {
    const nested = stripSourceCondition({
      exports: { ".": { import: { [SOURCE_CONDITION]: "./src/a.ts", default: "./dist/a.js" } } },
    });
    expect(nested.exports).toEqual({ ".": { import: { default: "./dist/a.js" } } });
  });

  it("keeps every other field and does not mutate its input", () => {
    expect(publishedManifest.dependencies).toEqual(workspaceManifest.dependencies);
    expect(publishedManifest.files).toEqual(["dist"]);
    expect(workspaceManifest.exports["."]).toHaveProperty(SOURCE_CONDITION);
  });
});

describe("inspectPackage", () => {
  it("accepts a published manifest whose exports all exist", () => {
    expect(inspectPackage(publishedManifest, publishedFiles)).toEqual([]);
  });

  it("accepts a package without dependencies", () => {
    const standalone = {
      name: "@open-ocpp-trace/viewer-standalone",
      version: "1.2.3",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./package.json": "./package.json",
      },
    };
    const files = ["package.json", "README.md", "LICENSE", "dist/index.d.ts", "dist/index.js"];
    expect(inspectPackage(standalone, files)).toEqual([]);
  });

  it("reports the source condition and its dangling target", () => {
    expect(inspectPackage(workspaceManifest, publishedFiles)).toEqual([
      `exports["."]["${SOURCE_CONDITION}"] is a development-only condition`,
      `exports["."]["${SOURCE_CONDITION}"] points to ./src/index.ts, which is not in the package`,
    ]);
  });

  it("reports a types path that is not in the package", () => {
    const manifest = {
      ...publishedManifest,
      exports: {
        ...publishedManifest.exports,
        ".": { types: "./dist/missing.d.ts", default: "./dist/index.js" },
      },
    };
    expect(inspectPackage(manifest, publishedFiles)).toEqual([
      'exports["."]["types"] points to ./dist/missing.d.ts, which is not in the package',
    ]);
  });

  it("reports a stylesheet export that is not in the package", () => {
    const files = publishedFiles.filter((file) => file !== "dist/styles.css");
    expect(inspectPackage(publishedManifest, files)).toEqual([
      'exports["./styles.css"] points to ./dist/styles.css, which is not in the package',
    ]);
  });

  it("reports a missing LICENSE or README.md", () => {
    const files = publishedFiles.filter((file) => file !== "LICENSE" && file !== "README.md");
    expect(inspectPackage(publishedManifest, files)).toEqual([
      "LICENSE is missing",
      "README.md is missing",
    ]);
  });

  it("reports files outside dist/", () => {
    const files = [...publishedFiles, "src/index.ts", "test/inspect.test.ts", ".env"];
    expect(inspectPackage(publishedManifest, files)).toEqual([
      "src/index.ts is not expected in the package",
      "test/inspect.test.ts is not expected in the package",
      ".env is not expected in the package",
    ]);
  });

  it("reports an unresolved workspace dependency", () => {
    const manifest = {
      ...publishedManifest,
      dependencies: { "@open-ocpp-trace/viewer-core": "workspace:*" },
    };
    expect(inspectPackage(manifest, publishedFiles)).toEqual([
      'dependencies["@open-ocpp-trace/viewer-core"] is workspace:*, not a published version',
    ]);
  });
});

describe("lockstepProblems", () => {
  // viewer-core depends on the SDK packages, which are released on their
  // own and are not part of the lockstep.
  const core = {
    name: "@open-ocpp-trace/viewer-core",
    version: "0.2.0",
    dependencies: { "@open-ocpp-trace/core": "0.1.0" },
    devDependencies: { "@open-ocpp-trace/jsonl": "0.1.0" },
  };
  const react = {
    name: "@open-ocpp-trace/viewer-react",
    version: "0.2.0",
    dependencies: {
      "@open-ocpp-trace/jsonl": "0.1.0",
      "@open-ocpp-trace/viewer-core": "0.2.0",
      other: "^1.0.0",
    },
  };
  const standalone = { name: "@open-ocpp-trace/viewer-standalone", version: "0.2.0" };

  it("accepts packages at one version whose viewer dependencies pin it", () => {
    expect(lockstepProblems([core, react, standalone])).toEqual([]);
  });

  it("accepts a workspace:* viewer dependency, which packing pins to the version", () => {
    const manifest = {
      ...react,
      dependencies: { ...react.dependencies, "@open-ocpp-trace/viewer-core": "workspace:*" },
    };
    expect(lockstepProblems([core, manifest, standalone])).toEqual([]);
  });

  it("reports a workspace range, which packing turns into a range", () => {
    const manifest = {
      ...react,
      dependencies: { ...react.dependencies, "@open-ocpp-trace/viewer-core": "workspace:^" },
    };
    expect(lockstepProblems([core, manifest, standalone])).toEqual([
      '@open-ocpp-trace/viewer-react dependencies["@open-ocpp-trace/viewer-core"] is workspace:^, not 0.2.0',
    ]);
  });

  it("reports packages at different versions", () => {
    expect(lockstepProblems([core, react, { ...standalone, version: "0.3.0" }])).toEqual([
      "@open-ocpp-trace/viewer-standalone is at 0.3.0, not 0.2.0 like @open-ocpp-trace/viewer-core",
    ]);
  });

  it("reports a viewer dependency on another version", () => {
    const manifest = { ...react, peerDependencies: { "@open-ocpp-trace/viewer-core": "^0.2.0" } };
    expect(lockstepProblems([core, manifest])).toEqual([
      '@open-ocpp-trace/viewer-react peerDependencies["@open-ocpp-trace/viewer-core"] is ^0.2.0, not 0.2.0',
    ]);
  });

  it("reports a viewer dependency that is not released with the others", () => {
    const manifest = { ...react, dependencies: { "@open-ocpp-trace/viewer-model": "0.2.0" } };
    expect(lockstepProblems([core, manifest])).toEqual([
      '@open-ocpp-trace/viewer-react dependencies["@open-ocpp-trace/viewer-model"] is not released with the other packages',
    ]);
  });

  it("reports a missing version and an empty list", () => {
    expect(lockstepProblems([{ name: "@open-ocpp-trace/viewer-core" }])).toEqual([
      "@open-ocpp-trace/viewer-core has no version",
    ]);
    expect(lockstepProblems([])).toEqual(["no package to release"]);
  });
});

describe("versionConstantProblems", () => {
  const core = { name: "@open-ocpp-trace/viewer-core", version: "0.2.0" };
  const source = (literal: string): string =>
    `/** Version. */\nexport const VIEWER_CORE_VERSION: string = "${literal}";\n`;

  it("accepts a VIEWER_*_VERSION literal at the shared version", () => {
    expect(versionConstantProblems(core, "0.2.0", source("0.2.0"))).toEqual([]);
  });

  it("derives the constant name from a multi-word package name", () => {
    const manifest = { name: "@open-ocpp-trace/viewer-web-component", version: "0.2.0" };
    const text = 'export const VIEWER_WEB_COMPONENT_VERSION = "0.2.0";';
    expect(versionConstantProblems(manifest, "0.2.0", text)).toEqual([]);
  });

  it("reports a literal that differs from the shared version", () => {
    expect(versionConstantProblems(core, "0.2.0", source("0.1.0"))).toEqual([
      "@open-ocpp-trace/viewer-core VIEWER_CORE_VERSION is 0.1.0, not 0.2.0",
    ]);
  });

  it("runs from the lockstep command on the workspace sources", () => {
    const directory = mkdtempSync(join(tmpdir(), "viewer-lockstep-"));
    try {
      const paths = ["core", "react", "standalone"].map((name) => {
        const path = join(directory, `${name}.json`);
        const manifest = {
          name: `@open-ocpp-trace/viewer-${name}`,
          version: "9.9.9",
          repository: { directory: `packages/${name}` },
        };
        writeFileSync(path, JSON.stringify(manifest));
        return path;
      });
      const script = fileURLToPath(new URL("release-manifest.ts", import.meta.url));
      const result = spawnSync(process.execPath, [script, "lockstep", ...paths], {
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/VIEWER_CORE_VERSION is \S+, not 9\.9\.9/);
      expect(result.stderr).toMatch(/VIEWER_REACT_VERSION is \S+, not 9\.9\.9/);
      expect(result.stderr).toMatch(/VIEWER_STANDALONE_VERSION is \S+, not 9\.9\.9/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports a source that does not declare the constant as a literal", () => {
    const text = "export const VIEWER_CORE_VERSION: string = pkg.version;";
    expect(versionConstantProblems(core, "0.2.0", text)).toEqual([
      "@open-ocpp-trace/viewer-core src/index.ts declares no VIEWER_CORE_VERSION string literal",
    ]);
  });
});

describe("the committed package manifests", () => {
  const manifests = ["core", "react", "standalone"].map(
    (name): Record<string, unknown> =>
      JSON.parse(
        readFileSync(new URL(`../packages/${name}/package.json`, import.meta.url), "utf8"),
      ) as Record<string, unknown>,
  );

  it("are in lockstep", () => {
    expect(lockstepProblems(manifests)).toEqual([]);
  });

  it("declare a VIEWER_*_VERSION constant at their version", () => {
    for (const [index, name] of ["core", "react", "standalone"].entries()) {
      const manifest = manifests[index] ?? {};
      const text = readFileSync(
        new URL(`../packages/${name}/src/index.ts`, import.meta.url),
        "utf8",
      );
      expect(versionConstantProblems(manifest, String(manifest.version), text)).toEqual([]);
    }
  });

  it("can be published to GitHub Packages", () => {
    for (const manifest of manifests) {
      expect(manifest).not.toHaveProperty("private");
      expect(manifest.publishConfig).toEqual({ registry: "https://npm.pkg.github.com" });
    }
  });

  it("lose every development-only condition once stripped", () => {
    for (const manifest of manifests) {
      expect(JSON.stringify(manifest.exports)).toContain('"@open-ocpp-trace/viewer-source"');
      expect(JSON.stringify(stripSourceCondition(manifest).exports)).not.toContain("viewer-source");
    }
  });
});
