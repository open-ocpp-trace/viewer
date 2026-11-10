// Structural guard of the controls against host base styles. The viewer
// renders in the host's light DOM, where a Tailwind preflight or a flowbite
// form rule (`[type='text'] { background-color: #fff }`) restyles every
// input and button. The real check runs in Chromium
// (scripts/host-styles-check); this test keeps the shape it relies on: each
// control the viewer renders matches a stylesheet rule that reverts every
// property (`all: revert`) with a selector that outranks those base rules.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { createCorrelator, createViewerStore } from "@open-ocpp-trace/viewer-core";
import { TraceViewer } from "@open-ocpp-trace/viewer-react";

import { sdkEntry } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

const CSS = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The selectors of the rules that declare `all: revert`. */
function hardenedSelectors(): string[] {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, , body]) => /(^|[;\s])all\s*:\s*revert\s*(;|$)/.test(body ?? ""))
    .flatMap(([, prelude]) => (prelude ?? "").split(",").map((selector) => selector.trim()));
}

/** [ids, classes + attributes + pseudo-classes, elements] of a plain selector. */
function specificity(selector: string): [number, number, number] {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = selector.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):[\w-]+/g)?.length ?? 0;
  const elements = selector.replace(/\[[^\]]*\]/g, "").match(/(^|[\s>+~])[a-z][\w-]*/gi)?.length;
  return [ids, classes, elements ?? 0];
}

function atLeast(actual: [number, number, number], floor: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== floor[i]) return (actual[i] ?? 0) > (floor[i] ?? 0);
  }
  return true;
}

// Above flowbite's strongest form rules: `[type='text']:focus` (0,2,0) and,
// for checkboxes, `.dark [type='checkbox']:checked` (0,3,0).
const FLOOR: [number, number, number] = [0, 2, 1];
const CHECKBOX_FLOOR: [number, number, number] = [0, 3, 1];

function renderViewer(): HTMLElement {
  const store = createViewerStore();
  store.load([
    sdkEntry("call", { messageId: "m1", action: "Authorize" }),
    sdkEntry("result", {
      messageId: "m1",
      messageType: "CALLRESULT",
      direction: "csms-to-cp",
      action: undefined,
    }),
  ]);
  const correlator = createCorrelator();
  correlator.connect(store);
  const { container } = render(
    <TraceViewer
      store={store}
      correlator={correlator}
      payloadSearch
      defaultSelection={{ entryId: "call" }}
      onCopy={() => {}}
    />,
  );
  return container;
}

describe("controls under host base styles", () => {
  it("renders every kind of control the stylesheet hardens", () => {
    const controls = renderViewer().querySelectorAll("input, button, select, textarea");
    const kinds = new Set([...controls].map((control) => control.className));
    expect(kinds).toEqual(
      new Set([
        "oot-toolbar-button",
        "oot-filter-reset",
        "oot-filter-clear",
        "oot-filter-input",
        "oot-filter-checkbox",
        "oot-inspector__button",
        "oot-inspector__link",
      ]),
    );
  });

  it("matches each control, fieldset and legend with a rule reverting every property", () => {
    const selectors = hardenedSelectors();
    const elements = renderViewer().querySelectorAll(
      "input, button, select, textarea, fieldset, legend",
    );
    expect(elements.length).toBeGreaterThan(10);
    for (const element of elements) {
      const matching = selectors.filter((selector) => element.matches(selector));
      const name = `${element.tagName.toLowerCase()}.${element.className}`;
      expect(matching, name).not.toEqual([]);
      const floor = element.getAttribute("type") === "checkbox" ? CHECKBOX_FLOOR : FLOOR;
      for (const selector of matching) {
        expect(atLeast(specificity(selector), floor), `${selector} below ${floor.join(",")}`).toBe(
          true,
        );
      }
    }
  });

  it("hardens the jump-to-latest button, rendered only while not following", () => {
    expect(hardenedSelectors()).toContainEqual(expect.stringMatching(/button\.oot-jump$/));
  });

  it("keeps a visible focus outline: reverted to the user agent, never set to none", () => {
    expect(CSS).not.toMatch(/outline\s*:\s*(none|0)\b/);
  });
});
