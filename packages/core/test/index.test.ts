import { describe, expect, it } from "vite-plus/test";

import { VIEWER_CORE_VERSION } from "@open-ocpp-trace/viewer-core";

describe("@open-ocpp-trace/viewer-core", () => {
  it("exposes its version from the package entry", () => {
    expect(VIEWER_CORE_VERSION).toBe("0.0.0");
  });
});
