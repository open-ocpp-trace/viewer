import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type EntryId,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";
import {
  defaultStrings,
  type DetailPanel,
  type FilterControl,
  type TranslateFunction,
  TraceViewer,
} from "@open-ocpp-trace/viewer-react";

import { add, sdkEntry } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

const ATTRIBUTES = ["aria-label", "aria-description", "title", "placeholder"] as const;

/**
 * Trace data, which no string covers: the value cells of trace rows, the
 * reason and preview of unparsed rows, inspector field values and blocks.
 */
const TRACE_DATA = [
  ".oot-row--trace [role=gridcell]",
  ".oot-unparsed-reason",
  ".oot-unparsed-raw",
  ".oot-row--unparsed [role=gridcell]:not(.oot-cell--unparsed)",
  ".oot-inspector__fields > dd",
  ".oot-inspector__code",
].join(", ");

/** Every default string leaf of at least 3 characters. */
function defaultTexts(node: object): string[] {
  return Object.values(node).flatMap((value: unknown): string[] => {
    if (typeof value === "string") return value.length >= 3 ? [value] : [];
    return typeof value === "object" && value !== null ? defaultTexts(value) : [];
  });
}

const DEFAULTS = defaultTexts(defaultStrings);

const translate: TranslateFunction = (key) => `⟦${key}⟧`;

/** The texts and labeling attributes the viewer shows, trace data excluded. */
function shownTexts(root: HTMLElement): string[] {
  const texts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || parent.closest(TRACE_DATA) !== null) continue;
    texts.push(node.textContent ?? "");
  }
  for (const element of root.querySelectorAll("*")) {
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value !== null) texts.push(value);
    }
  }
  return texts;
}

/** The default strings found in `texts`, translated keys stripped first. */
function leftovers(texts: readonly string[]): string[] {
  return texts.flatMap((text) => {
    const rest = text.replace(/⟦[^⟧]*⟧/g, "");
    return DEFAULTS.filter((english) => rest.includes(english)).map(
      (english) => `${JSON.stringify(english)} in ${JSON.stringify(text)}`,
    );
  });
}

/** Nests `depth` objects with a loop, past the inspector's depth limit. */
function deep(depth: number): unknown {
  let value: unknown = "bottom";
  for (let i = 0; i < depth; i++) value = { next: value };
  return value;
}

/** The default inspector markers, printed inside code blocks. */
const MARKERS = Object.values(defaultStrings.inspector.markers);

const ENTRIES: ViewerEntry[] = [
  sdkEntry("call", { action: "Authorize", messageId: "m-1" }),
  sdkEntry("result", {
    direction: "csms-to-cp",
    messageType: "CALLRESULT",
    messageId: "m-1",
    action: undefined,
    payload: { status: "Accepted" },
  }),
  sdkEntry("orphan", {
    direction: "csms-to-cp",
    messageType: "CALLRESULT",
    messageId: "m-2",
    action: undefined,
  }),
  { kind: "unparsed", id: "u", raw: "{not json", reason: "invalid JSON" },
  { kind: "gap", id: "g", reason: "disconnected", missedCount: 3 },
];

/** A host panel that always fails, to show the localized fallback. */
const CRASHING: DetailPanel = {
  id: "crashing",
  title: "⟦host panel⟧",
  render: () => {
    throw new Error("host panel failure");
  },
};

/** A host filter control that always fails, to show the localized fallback. */
const CRASHING_CONTROL: FilterControl = {
  id: "crashing",
  label: "⟦host control⟧",
  render: () => {
    throw new Error("host control failure");
  },
};

describe("a fully translated viewer", () => {
  it("shows no default English string in any state", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createViewerStore();
    const correlator = createCorrelator();
    correlator.connect(store);
    store.load(ENTRIES);
    const view = (selected: EntryId | null) => (
      <TraceViewer
        store={store}
        correlator={correlator}
        translate={translate}
        onExport={() => {}}
        onCopy={() => {}}
        filter={{ timeRange: { from: "soon" } }}
        selection={{ entryId: selected }}
        detailPanels={[CRASHING]}
        filterControls={[CRASHING_CONTROL]}
        payloadSearch
      />
    );
    const { container, rerender } = render(view(null));
    const all: string[] = [];
    const collect = (): void => {
      all.push(...shownTexts(container));
    };

    collect();
    fireEvent.click(screen.getByRole("button", { name: "⟦toolbar.exportFiltered⟧" }));
    fireEvent.click(screen.getByRole("button", { name: "⟦toolbar.follow⟧" }));
    fireEvent.click(screen.getByRole("button", { name: "⟦toolbar.pause⟧" }));
    act(() => store.apply([add(sdkEntry("late"))]));
    expect(screen.getByRole("alert").textContent).toBe("⟦filter.invalid⟧");
    expect(screen.getByRole("status").textContent).toBe("⟦toolbar.exported⟧");
    expect(screen.getByText("⟦toolbar.pending⟧")).toBeDefined();
    expect(screen.getByRole("button", { name: "⟦jumpToLatest⟧" })).toBeDefined();
    collect();
    for (const id of ["call", "result", "orphan", "u", "g", "missing"]) {
      rerender(view(id));
      collect();
    }

    // The walk saw every state: translated toolbar, list, panel and inspector.
    for (const key of [
      "toolbar.exported",
      "columns.action",
      "filter.kinds",
      "filter.option",
      "gap",
      "unparsed",
      "inspector.goToResponse",
      "inspector.goToCall",
      "inspector.noMatchingCall",
      "inspector.blocks.payload",
      "inspector.copy",
      "inspector.rawHidden",
      "inspector.gone",
      "detailPanelError",
      "filterControlError",
    ]) {
      expect(
        all.some((text) => text.includes(`⟦${key}⟧`)),
        key,
      ).toBe(true);
    }
    expect(leftovers(all)).toEqual([]);
    quiet.mockRestore();
  });

  it("prints translated markers in the inspector's code blocks", () => {
    const store = createViewerStore();
    store.load([sdkEntry("marked", { payload: { idTag: "SECRET", nested: deep(70) } })]);
    const { container } = render(
      <TraceViewer store={store} translate={translate} selection={{ entryId: "marked" }} />,
    );
    const code = [...container.querySelectorAll(".oot-inspector__code")].map(
      (block) => block.textContent ?? "",
    );
    for (const key of ["inspector.markers.redacted", "inspector.markers.elidedObject"]) {
      expect(
        code.some((text) => text.includes(`⟦${key}⟧`)),
        key,
      ).toBe(true);
    }
    const left = code.flatMap((text) =>
      MARKERS.filter((marker) => text.replace(/⟦[^⟧]*⟧/g, "").includes(marker)),
    );
    expect(left).toEqual([]);
  });

  it("finds the default strings of an untranslated viewer", () => {
    const store = createViewerStore();
    store.load(ENTRIES);
    const { container } = render(<TraceViewer store={store} onExport={() => {}} />);
    expect(leftovers(shownTexts(container))).toContain('"Export filtered" in "Export filtered"');
  });
});
