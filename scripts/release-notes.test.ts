import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

const script = fileURLToPath(new URL("release-notes.sh", import.meta.url));

/**
 * Runs a copy of release-notes.sh from the temporary directory: the script
 * finds packages/ from its own location, not from the working directory.
 */
function run(scriptPath: string, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync("sh", [scriptPath, ...args], { cwd: tmpdir(), encoding: "utf8" });
}

const HEADER = `# Changelog

All notable changes are documented in this file.

`;

describe("release-notes.sh on the committed changelogs", () => {
  it("prints the Unreleased section of every package", () => {
    const result = run(script, ["Unreleased"]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const name of ["core", "react", "standalone"]) {
      expect(result.stdout).toContain(`## @open-ocpp-trace/viewer-${name}\n`);
    }
    expect(result.stdout).toContain("### Added");
    // The section ends before the reference link definitions.
    expect(result.stdout).not.toMatch(/^\[unreleased\]: /m);
  });
});

describe("release-notes.sh on fixture changelogs", () => {
  let workspace: string | undefined;

  afterEach(() => {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  });

  /** A copy of the script in a workspace whose `demo` package has `changelog`. */
  function fixture(changelog: string): string {
    workspace = mkdtempSync(join(tmpdir(), "viewer-release-notes-"));
    mkdirSync(join(workspace, "scripts"));
    mkdirSync(join(workspace, "packages", "demo"), { recursive: true });
    const copy = join(workspace, "scripts", "release-notes.sh");
    copyFileSync(script, copy);
    writeFileSync(join(workspace, "packages", "demo", "CHANGELOG.md"), changelog);
    return copy;
  }

  it("prints a section up to the next heading", () => {
    const copy = fixture(
      `${HEADER}## [1.2.0] - 2026-01-02\n\n### Added\n\n- New thing.\n\n## [1.1.0] - 2026-01-01\n\n- Old thing.\n`,
    );
    const result = run(copy, ["1.2.0", "demo"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("## @open-ocpp-trace/viewer-demo\n\n### Added\n\n- New thing.\n");
  });

  it("stops at the reference link definitions", () => {
    const copy = fixture(
      `${HEADER}## [1.2.0]\n\n- Last thing.\n\n[1.2.0]: https://example.com/1.2.0\n[unreleased]: https://example.com/head\n`,
    );
    const result = run(copy, ["1.2.0", "demo"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("## @open-ocpp-trace/viewer-demo\n\n- Last thing.\n");
  });

  it("matches the version literally, not as a pattern", () => {
    const copy = fixture(`${HEADER}## [1x2x0]\n\n- Wrong.\n\n## [1.2.0]\n\n- Right.\n`);
    const result = run(copy, ["1.2.0", "demo"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("## @open-ocpp-trace/viewer-demo\n\n- Right.\n");
  });

  it("fails on a missing section", () => {
    const copy = fixture(`${HEADER}## [1.1.0]\n\n- Old thing.\n`);
    const result = run(copy, ["1.2.0", "demo"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("has no entries under ## [1.2.0]");
  });

  it("fails on an empty section", () => {
    const copy = fixture(`${HEADER}## [Unreleased]\n\n## [1.1.0]\n\n- Old thing.\n`);
    const result = run(copy, ["Unreleased", "demo"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has no entries under ## [Unreleased]");
  });

  it("fails on a package without a changelog", () => {
    const copy = fixture(`${HEADER}## [1.2.0]\n\n- New thing.\n`);
    const result = run(copy, ["1.2.0", "missing"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no CHANGELOG.md in packages/missing");
  });
});
