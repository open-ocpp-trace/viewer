import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { createViewerStore } from "@open-ocpp-trace/viewer-core";

describe("React test environment", () => {
  it("renders components into a DOM", () => {
    render(<p>hello</p>);
    expect(screen.getByText("hello").tagName).toBe("P");
  });

  it("loads viewer-core from its sources", () => {
    // `dist` is only built by `vp pack`; the source condition must win.
    expect(createViewerStore().size).toBe(0);
  });
});
