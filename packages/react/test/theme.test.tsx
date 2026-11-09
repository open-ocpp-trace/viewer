import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { createViewerStore } from "@open-ocpp-trace/viewer-core";
import { TraceViewer, themeTokens, type ViewerTheme } from "@open-ocpp-trace/viewer-react";

import { stubLayout } from "./layout.ts";

stubLayout();

function root(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".oot-viewer");
  if (element === null) throw new Error("no viewer root");
  return element;
}

function viewer(theme?: ViewerTheme): HTMLElement {
  const store = createViewerStore({});
  const { container } = render(
    theme === undefined ? (
      <TraceViewer store={store} />
    ) : (
      <TraceViewer store={store} theme={theme} />
    ),
  );
  return root(container);
}

describe("theme", () => {
  it("follows the operating system by default", () => {
    expect(viewer().dataset["ootColorScheme"]).toBe("auto");
    expect(viewer({}).dataset["ootColorScheme"]).toBe("auto");
  });

  it("marks the root with the requested color scheme", () => {
    for (const colorScheme of ["light", "dark", "auto"] as const) {
      expect(viewer({ colorScheme }).dataset["ootColorScheme"]).toBe(colorScheme);
    }
  });

  it("sets each token as an inline --oot-* custom property on the root", () => {
    const element = viewer({
      tokens: { borderColor: "rgb(1 2 3)", background: "black", codeMaxHeight: "10em" },
    });
    expect(element.style.getPropertyValue("--oot-border-color")).toBe("rgb(1 2 3)");
    expect(element.style.getPropertyValue("--oot-background")).toBe("black");
    expect(element.style.getPropertyValue("--oot-code-max-height")).toBe("10em");
    expect(element.style.getPropertyValue("--oot-color")).toBe("");
  });

  it("ignores unknown token keys and non-string values", () => {
    const element = viewer({
      tokens: { bogus: "red", color: 3, background: "black" },
    } as unknown as ViewerTheme);
    expect(element.style.getPropertyValue("--oot-bogus")).toBe("");
    expect(element.style.getPropertyValue("--oot-color")).toBe("");
    expect(element.style.getPropertyValue("--oot-background")).toBe("black");
  });

  it("keeps the layout styles of the root next to the tokens", () => {
    const element = viewer({ tokens: { color: "red" } });
    expect(element.style.display).toBe("flex");
    expect(element.style.getPropertyValue("--oot-color")).toBe("red");
  });

  it("keeps the tokens of two viewers in one document apart", () => {
    const first = viewer({ colorScheme: "dark", tokens: { background: "black" } });
    const second = viewer({ colorScheme: "light", tokens: { background: "white" } });
    expect(first.dataset["ootColorScheme"]).toBe("dark");
    expect(second.dataset["ootColorScheme"]).toBe("light");
    expect(first.style.getPropertyValue("--oot-background")).toBe("black");
    expect(second.style.getPropertyValue("--oot-background")).toBe("white");
    expect(document.documentElement.style.getPropertyValue("--oot-background")).toBe("");
  });

  it("lists the tokens in camelCase", () => {
    expect(themeTokens.length).toBeGreaterThan(0);
    for (const token of themeTokens) expect(token).toMatch(/^[a-z][A-Za-z]*$/);
  });
});
