import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createViewerStore,
  type EntryId,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { TraceList, useFilterEngine } from "@open-ocpp-trace/viewer-react";

import { add, sdkEntry } from "./fixtures.ts";
import { ROW_HEIGHT, stubLayout, VIEWPORT_ROWS } from "./layout.ts";

stubLayout();

function Harness(props: {
  store: ViewerStore;
  onSelect?: (id: EntryId | null) => void;
}): ReactElement {
  const engine = useFilterEngine(props.store);
  const [selectedId, setSelectedId] = useState<EntryId | null>(null);
  return (
    <TraceList
      engine={engine}
      selectedId={selectedId}
      onSelectedIdChange={(id) => {
        setSelectedId(id);
        props.onSelect?.(id);
      }}
    />
  );
}

function entries(count: number, from = 0): ViewerEntry[] {
  return Array.from({ length: count }, (_, i) => sdkEntry(`e${from + i}`));
}

function storeWith(count: number, maxEntries?: number): ViewerStore {
  const store = createViewerStore(maxEntries === undefined ? {} : { maxEntries });
  store.load(entries(count));
  return store;
}

function grid(): HTMLElement {
  return screen.getByRole("grid");
}

/** Delivers the `scroll` event a browser fires after a scroll. */
function scrolled(): void {
  fireEvent.scroll(grid());
}

function renderedIds(): string[] {
  return screen
    .getAllByRole("row")
    .flatMap((row) => (row.dataset["entryId"] === undefined ? [] : [row.dataset["entryId"]]));
}

function selectedIds(): string[] {
  return screen
    .getAllByRole("row")
    .filter((row) => row.getAttribute("aria-selected") === "true")
    .map((row) => row.dataset["entryId"] ?? "");
}

function row(id: string): HTMLElement {
  const found = screen.getAllByRole("row").find((candidate) => candidate.dataset["entryId"] === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

function press(key: string): void {
  fireEvent.keyDown(grid(), { key });
  scrolled();
}

function jumpButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Jump to latest" });
}

describe("<TraceList> selection", () => {
  it("selects a row on click", () => {
    const onSelect = vi.fn();
    render(<Harness store={storeWith(3)} onSelect={onSelect} />);
    fireEvent.click(row("e1"));
    expect(onSelect).toHaveBeenCalledWith("e1");
    expect(selectedIds()).toEqual(["e1"]);
    expect(row("e0").getAttribute("aria-selected")).toBe("false");
  });

  it("moves the selection with the arrow keys and points the grid at it", () => {
    render(<Harness store={storeWith(3)} />);
    expect(grid().tabIndex).toBe(0);
    expect(grid().hasAttribute("aria-activedescendant")).toBe(false);

    press("ArrowDown");
    expect(selectedIds()).toEqual(["e0"]);
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    expect(selectedIds()).toEqual(["e2"]);
    expect(grid().getAttribute("aria-activedescendant")).toBe(row("e2").id);
    press("ArrowUp");
    expect(selectedIds()).toEqual(["e1"]);
    expect(grid().getAttribute("aria-activedescendant")).toBe(row("e1").id);
  });

  it("goes to the first and the last row with Home and End, and scrolls them into view", () => {
    render(<Harness store={storeWith(100)} />);
    press("Home");
    expect(selectedIds()).toEqual(["e0"]);
    expect(renderedIds()).not.toContain("e99");
    press("End");
    expect(selectedIds()).toEqual(["e99"]);
    press("Home");
    expect(selectedIds()).toEqual(["e0"]);
  });

  it("scrolls a row selected upward below the sticky header, not under it", () => {
    render(<Harness store={storeWith(100)} />);
    scrolled();
    press("End");
    press("Home");
    expect(grid().scrollTop).toBe(0);

    grid().scrollTop = 50 * ROW_HEIGHT;
    scrolled();
    fireEvent.click(row("e50"));
    press("ArrowUp");
    expect(selectedIds()).toEqual(["e49"]);
    expect(grid().scrollTop).toBe(49 * ROW_HEIGHT);
  });

  it("moves by a page with PageDown and PageUp", () => {
    render(<Harness store={storeWith(100)} />);
    press("Home");
    press("PageDown");
    expect(selectedIds()).toEqual([`e${VIEWPORT_ROWS - 1}`]);
    press("PageDown");
    press("PageUp");
    expect(selectedIds()).toEqual([`e${VIEWPORT_ROWS - 1}`]);
    press("PageUp");
    press("PageUp");
    expect(selectedIds()).toEqual(["e0"]);
  });

  it("selects the last row on ArrowUp when nothing is selected", () => {
    render(<Harness store={storeWith(3)} />);
    press("ArrowUp");
    expect(selectedIds()).toEqual(["e2"]);
  });
});

describe("<TraceList> follow-scroll", () => {
  it("keeps the newest row rendered as entries are added", () => {
    const store = storeWith(100);
    render(<Harness store={store} />);
    scrolled();
    expect(renderedIds()).toContain("e99");
    expect(jumpButton()).toBeNull();

    act(() => store.apply(entries(50, 100).map(add)));
    scrolled();
    expect(renderedIds()).toContain("e149");
    expect(renderedIds()).not.toContain("e0");
  });

  it("keeps following when the scroll event of an earlier write arrives late", () => {
    const store = storeWith(100);
    render(<Harness store={store} />);
    scrolled();
    act(() => store.apply(entries(10, 100).map(add)));
    const firstWrite = grid().scrollTop;
    act(() => store.apply(entries(10, 110).map(add)));
    grid().scrollTop = firstWrite;
    scrolled();
    expect(jumpButton()).toBeNull();
  });

  it("stops following when the user scrolls up, and resumes with Jump to latest", () => {
    const store = storeWith(100);
    render(<Harness store={store} />);
    scrolled();

    grid().scrollTop = 0;
    scrolled();
    act(() => store.apply(entries(50, 100).map(add)));
    scrolled();
    expect(grid().scrollTop).toBe(0);
    expect(renderedIds()).toContain("e0");
    expect(renderedIds()).not.toContain("e149");

    fireEvent.click(jumpButton()!);
    scrolled();
    expect(jumpButton()).toBeNull();
    expect(renderedIds()).toContain("e149");
    act(() => store.apply(entries(1, 150).map(add)));
    scrolled();
    expect(renderedIds()).toContain("e150");
  });

  it("keeps the viewed row in place while a full store evicts from the front", () => {
    const store = storeWith(100, 100);
    render(<Harness store={store} />);
    scrolled();
    grid().scrollTop = 20 * ROW_HEIGHT;
    scrolled();
    expect(jumpButton()).not.toBeNull();

    act(() => store.apply(entries(10, 100).map(add)));
    scrolled();
    expect(store.size).toBe(100);
    expect(grid().scrollTop).toBe(10 * ROW_HEIGHT);
    // The row's top in the viewport is its offset minus the scroll position.
    expect(row("e20").style.transform).toBe(`translateY(${10 * ROW_HEIGHT}px)`);
    expect(jumpButton()).not.toBeNull();
  });

  it("goes back to the top when the viewed row is evicted", () => {
    const store = storeWith(100, 100);
    render(<Harness store={store} />);
    scrolled();
    grid().scrollTop = 5 * ROW_HEIGHT;
    scrolled();

    act(() => store.apply(entries(10, 100).map(add)));
    scrolled();
    expect(grid().scrollTop).toBe(0);
    expect(renderedIds()).toContain("e10");
    expect(jumpButton()).not.toBeNull();
  });

  it("stops following when the keyboard selects an older row", () => {
    const store = storeWith(100);
    render(<Harness store={store} />);
    scrolled();
    press("End");
    expect(jumpButton()).toBeNull();
    press("ArrowUp");
    expect(selectedIds()).toEqual(["e98"]);
    expect(jumpButton()).not.toBeNull();
    act(() => store.apply(entries(50, 100).map(add)));
    scrolled();
    expect(renderedIds()).toContain("e98");
    expect(renderedIds()).not.toContain("e149");
  });

  it("stops following when a click selects an older row", () => {
    const store = storeWith(100);
    render(<Harness store={store} />);
    scrolled();
    expect(jumpButton()).toBeNull();
    fireEvent.click(row("e98"));
    expect(selectedIds()).toEqual(["e98"]);
    expect(jumpButton()).not.toBeNull();
    act(() => store.apply(entries(50, 100).map(add)));
    scrolled();
    expect(renderedIds()).toContain("e98");
    expect(renderedIds()).not.toContain("e149");
  });

  it("keeps following when a click selects the newest row", () => {
    const store = storeWith(100);
    render(<Harness store={store} />);
    scrolled();
    fireEvent.click(row("e99"));
    expect(selectedIds()).toEqual(["e99"]);
    expect(jumpButton()).toBeNull();
    act(() => store.apply(entries(50, 100).map(add)));
    scrolled();
    expect(renderedIds()).toContain("e149");
  });
});
