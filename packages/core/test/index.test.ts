import { describe, expect, it } from "vite-plus/test";

import * as viewerCore from "@open-ocpp-trace/viewer-core";
import { VIEWER_CORE_VERSION } from "@open-ocpp-trace/viewer-core";

describe("@open-ocpp-trace/viewer-core", () => {
  it("exposes its version from the package entry", () => {
    expect(VIEWER_CORE_VERSION).toBe("0.0.0");
  });

  it("exposes only its public runtime values", () => {
    expect(Object.keys(viewerCore).sort()).toEqual([
      "DEFAULT_MAX_BYTES",
      "DEFAULT_MAX_ENTRIES",
      "STORE_ID_PREFIX",
      "VIEWER_CORE_VERSION",
      "computeStats",
      "createCorrelator",
      "createFilterEngine",
      "createViewerStore",
    ]);
    expect(viewerCore.STORE_ID_PREFIX).toBe("viewer-store:");
  });
});
