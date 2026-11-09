import { fireEvent, render, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import {
  createViewerStore,
  type ColumnDefinition,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import {
  TraceViewer,
  type DetailPanel,
  type PartialViewerStrings,
  type ToolbarAction,
} from "@open-ocpp-trace/viewer-react";

import { sdkEntry } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

function storeWith(entries: ViewerEntry[]): ViewerStore {
  const store = createViewerStore();
  store.load(entries);
  return store;
}

const ENTRIES = ["a", "b"].map((id): ViewerEntry => ({
  ...sdkEntry(id),
  metadata: { custom: { site: `site-${id}` } },
}));

/** The same slots, given to both viewers. */
const COLUMNS: readonly ColumnDefinition[] = [
  {
    id: "site",
    label: "Site",
    value: (entry) => {
      const site = entry.metadata?.custom?.["site"];
      return typeof site === "string" ? site : undefined;
    },
  },
];
const ACTIONS: readonly ToolbarAction[] = [
  {
    id: "first",
    label: "Select first",
    run: (context) => context.select(context.listed()[0]?.id ?? null),
  },
];
const PANELS: readonly DetailPanel[] = [
  { id: "id", title: "Host panel", render: ({ entry }) => <p>panel of {entry.id}</p> },
];

const FRENCH: PartialViewerStrings = { listLabel: "Entrées", columns: { action: "Action FR" } };

function roots(container: HTMLElement): [HTMLElement, HTMLElement] {
  const found = container.querySelectorAll<HTMLElement>(".oot-viewer");
  const [first, second] = found;
  if (found.length !== 2 || first === undefined || second === undefined) {
    throw new Error("expected two viewer roots");
  }
  return [first, second];
}

describe("two viewers in one document", () => {
  it("keep their own theme, strings and slot output", () => {
    const { container } = render(
      <>
        <TraceViewer
          store={storeWith(ENTRIES)}
          theme={{ colorScheme: "light", tokens: { background: "white" } }}
          columns={COLUMNS}
          toolbarActions={ACTIONS}
          detailPanels={PANELS}
        />
        <TraceViewer
          store={storeWith(ENTRIES)}
          theme={{ colorScheme: "dark", tokens: { background: "black" } }}
          strings={FRENCH}
          columns={COLUMNS}
          toolbarActions={ACTIONS}
          detailPanels={PANELS}
        />
      </>,
    );
    const [english, french] = roots(container);

    expect(english.dataset["ootColorScheme"]).toBe("light");
    expect(french.dataset["ootColorScheme"]).toBe("dark");
    expect(english.style.getPropertyValue("--oot-background")).toBe("white");
    expect(french.style.getPropertyValue("--oot-background")).toBe("black");

    expect(within(english).getByRole("grid", { name: "Trace entries" })).toBeDefined();
    expect(within(english).queryByRole("grid", { name: "Entrées" })).toBeNull();
    expect(within(french).getByRole("grid", { name: "Entrées" })).toBeDefined();
    expect(within(english).getByText("Action")).toBeDefined();
    expect(within(english).queryByText("Action FR")).toBeNull();
    expect(within(french).getByText("Action FR")).toBeDefined();

    for (const root of [english, french]) {
      expect(within(root).getByText("Site")).toBeDefined();
      expect(within(root).getByText("site-a")).toBeDefined();
    }

    fireEvent.click(within(french).getByRole("button", { name: "Select first" }));
    expect(within(french).getByRole("region", { name: "Host panel" }).textContent).toContain(
      "panel of a",
    );
    expect(within(english).queryByRole("region", { name: "Host panel" })).toBeNull();
  });
});
