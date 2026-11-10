import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import * as viewerCore from "@open-ocpp-trace/viewer-core";
import { VIEWER_CORE_VERSION } from "@open-ocpp-trace/viewer-core";

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
) as { version: string };

describe("@open-ocpp-trace/viewer-core", () => {
  it("exposes the version of its package.json from the package entry", () => {
    expect(VIEWER_CORE_VERSION).toBe(MANIFEST.version);
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
      "readEntryFields",
      "reportViewerError",
    ]);
    expect(viewerCore.STORE_ID_PREFIX).toBe("viewer-store:");
  });
});
