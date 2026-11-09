import { version as reactVersion } from "react";
import { describe, expect, it } from "vite-plus/test";

import { VIEWER_REACT_VERSION, hostReactVersion } from "@open-ocpp-trace/viewer-react";

describe("@open-ocpp-trace/viewer-react", () => {
  it("exposes its version from the package entry", () => {
    expect(VIEWER_REACT_VERSION).toBe("0.0.0");
  });

  it("uses the React copy provided by the host", () => {
    expect(hostReactVersion()).toBe(reactVersion);
  });
});
