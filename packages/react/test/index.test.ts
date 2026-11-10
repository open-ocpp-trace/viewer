import { readFileSync } from "node:fs";
import { join } from "node:path";

import { version as reactVersion } from "react";
import { describe, expect, it } from "vite-plus/test";

import { VIEWER_REACT_VERSION, hostReactVersion } from "@open-ocpp-trace/viewer-react";

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
) as { version: string };

describe("@open-ocpp-trace/viewer-react", () => {
  it("exposes the version of its package.json from the package entry", () => {
    expect(VIEWER_REACT_VERSION).toBe(MANIFEST.version);
  });

  it("uses the React copy provided by the host", () => {
    expect(hostReactVersion()).toBe(reactVersion);
  });
});
