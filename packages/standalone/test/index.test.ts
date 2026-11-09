import { describe, expect, it } from "vite-plus/test";

import { VIEWER_STANDALONE_VERSION, bundledReactVersion } from "@open-ocpp-trace/viewer-standalone";

describe("@open-ocpp-trace/viewer-standalone", () => {
  it("exposes its version from the package entry", () => {
    expect(VIEWER_STANDALONE_VERSION).toBe("0.0.0");
  });

  it("reports the React version it uses", () => {
    expect(bundledReactVersion()).toMatch(/^19\./);
  });
});
