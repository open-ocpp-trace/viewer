import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { VIEWER_STANDALONE_VERSION, bundledReactVersion } from "@open-ocpp-trace/viewer-standalone";

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
) as { version: string };

describe("@open-ocpp-trace/viewer-standalone", () => {
  it("exposes the version of its package.json from the package entry", () => {
    expect(VIEWER_STANDALONE_VERSION).toBe(MANIFEST.version);
  });

  it("reports the React version it uses", () => {
    expect(bundledReactVersion()).toMatch(/^19\./);
  });
});
