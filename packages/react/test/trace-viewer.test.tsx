import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Profiler, StrictMode, useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createViewerStore,
  type ViewerEntry,
  type ViewerSelection,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { TraceViewer } from "@open-ocpp-trace/viewer-react";

import { add, sdkEntry } from "./fixtures.ts";
import { stubLayout, VIEWPORT_ROWS } from "./layout.ts";

stubLayout();

function storeWith(entries: ViewerEntry[], maxEntries?: number): ViewerStore {
  const store = createViewerStore(maxEntries === undefined ? {} : { maxEntries });
  store.load(entries);
  return store;
}

function listedIds(): string[] {
  return within(screen.getByRole("grid"))
    .getAllByRole("row")
    .flatMap((row) => (row.dataset["entryId"] === undefined ? [] : [row.dataset["entryId"]]));
}

function selectedIds(): string[] {
  return within(screen.getByRole("grid"))
    .getAllByRole("row")
    .filter((row) => row.getAttribute("aria-selected") === "true")
    .map((row) => row.dataset["entryId"] ?? "");
}

function row(id: string): HTMLElement {
  const found = within(screen.getByRole("grid"))
    .getAllByRole("row")
    .find((candidate) => candidate.dataset["entryId"] === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

function chargePoint(name: string): HTMLElement {
  return within(screen.getByRole("group", { name: "Charge points" })).getByRole("checkbox", {
    name,
  });
}

const ENTRIES = [
  sdkEntry("a"),
  sdkEntry("b", { chargePointId: "CP-2" }),
  sdkEntry("c", { action: "Authorize" }),
];

describe("<TraceViewer>", () => {
  it("lists a snapshot of SDK records, then incremental adds", () => {
    const store = storeWith(ENTRIES);
    const { container } = render(<TraceViewer store={store} />);
    expect(container.firstElementChild?.className).toBe("oot-viewer");
    expect(listedIds()).toEqual(["a", "b", "c"]);
    act(() => store.apply([add(sdkEntry("d"))]));
    expect(listedIds()).toEqual(["a", "b", "c", "d"]);
  });

  it("labels every control", () => {
    render(<TraceViewer store={storeWith(ENTRIES)} payloadSearch />);
    for (const role of ["button", "checkbox", "textbox", "searchbox", "grid", "group"] as const) {
      const all = screen.getAllByRole(role);
      expect(all.length).toBeGreaterThan(0);
      expect(screen.getAllByRole(role, { name: /\S/ })).toHaveLength(all.length);
    }
  });

  it("applies a filter controlled by the parent and reports user edits", () => {
    const onFilterChange = vi.fn();
    const store = storeWith(ENTRIES);
    const { rerender } = render(
      <TraceViewer
        store={store}
        filter={{ chargePointIds: ["CP-2"] }}
        onFilterChange={onFilterChange}
      />,
    );
    expect(listedIds()).toEqual(["b"]);
    fireEvent.click(chargePoint("CP-1 (2)"));
    expect(onFilterChange).toHaveBeenCalledWith({ chargePointIds: ["CP-2", "CP-1"] });
    expect(listedIds()).toEqual(["b"]);
    rerender(<TraceViewer store={store} filter={{ actions: ["Authorize"] }} />);
    expect(listedIds()).toEqual(["c"]);
  });

  describe("pause", () => {
    it("holds new entries back while paused, with their count, and lists them on resume", () => {
      const store = storeWith(ENTRIES);
      render(<TraceViewer store={store} />);
      const pause = screen.getByRole("button", { name: "Pause" });
      expect(pause.getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(pause);
      expect(store.paused).toBe(true);
      expect(pause.getAttribute("aria-pressed")).toBe("true");
      act(() => store.apply([add(sdkEntry("d")), add(sdkEntry("e"))]));
      expect(listedIds()).toEqual(["a", "b", "c"]);
      expect(screen.getByText("2 pending")).toBeTruthy();

      fireEvent.click(pause);
      expect(store.paused).toBe(false);
      expect(pause.getAttribute("aria-pressed")).toBe("false");
      expect(listedIds()).toEqual(["a", "b", "c", "d", "e"]);
      expect(screen.queryByText(/pending/)).toBeNull();
    });
  });

  describe("follow", () => {
    it("turns following off and on from the toolbar", () => {
      const store = storeWith(Array.from({ length: 100 }, (_, i) => sdkEntry(`e${i}`)));
      render(<TraceViewer store={store} />);
      const follow = screen.getByRole("button", { name: "Follow latest" });
      expect(follow.getAttribute("aria-pressed")).toBe("true");

      fireEvent.click(follow);
      expect(follow.getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("button", { name: "Jump to latest" })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
      expect(follow.getAttribute("aria-pressed")).toBe("true");
    });
  });

  describe("selection", () => {
    it("survives updates and a filter that hides then shows the entry", () => {
      const onSelectionChange = vi.fn();
      const store = storeWith(ENTRIES);
      render(<TraceViewer store={store} onSelectionChange={onSelectionChange} />);
      fireEvent.click(row("a"));
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ entryId: "a" });
      expect(selectedIds()).toEqual(["a"]);

      act(() => store.apply([{ type: "update", id: "a", metadata: { tenant: "t" } }]));
      expect(selectedIds()).toEqual(["a"]);

      fireEvent.click(chargePoint("CP-2 (1)"));
      expect(listedIds()).toEqual(["b"]);
      expect(selectedIds()).toEqual([]);
      fireEvent.click(chargePoint("CP-2 (1)"));
      expect(selectedIds()).toEqual(["a"]);
      expect(onSelectionChange).toHaveBeenCalledTimes(1);
    });

    it("starts from defaultSelection", () => {
      render(<TraceViewer store={storeWith(ENTRIES)} defaultSelection={{ entryId: "b" }} />);
      expect(selectedIds()).toEqual(["b"]);
    });

    it("clears the selection once when the entry is evicted", () => {
      const onSelectionChange = vi.fn();
      const store = storeWith(ENTRIES.slice(0, 2), 2);
      render(
        <TraceViewer
          store={store}
          defaultSelection={{ entryId: "a" }}
          onSelectionChange={onSelectionChange}
        />,
      );
      act(() => store.apply([add(sdkEntry("c"))]));
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ entryId: null });
      act(() => store.apply([add(sdkEntry("a"))]));
      expect(listedIds()).toEqual(["c", "a"]);
      expect(selectedIds()).toEqual([]);
      expect(onSelectionChange).toHaveBeenCalledTimes(1);
    });

    it("clears the selection once when the store is cleared", () => {
      const onSelectionChange = vi.fn();
      const store = storeWith(ENTRIES);
      render(
        <TraceViewer
          store={store}
          defaultSelection={{ entryId: "b" }}
          onSelectionChange={onSelectionChange}
        />,
      );
      act(() => store.clear());
      act(() => store.apply([add(sdkEntry("b"))]));
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ entryId: null });
      expect(selectedIds()).toEqual([]);
    });

    it("keeps the store ingesting when the host callback throws", () => {
      const report = vi.fn();
      vi.stubGlobal("reportError", report);
      try {
        const failure = new Error("host failure");
        const onSelectionChange = vi.fn(() => {
          throw failure;
        });
        const store = storeWith(ENTRIES.slice(0, 2), 2);
        render(
          <TraceViewer
            store={store}
            defaultSelection={{ entryId: "a" }}
            onSelectionChange={onSelectionChange}
          />,
        );
        expect(() => act(() => store.apply([add(sdkEntry("c"))]))).not.toThrow();
        expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ entryId: null });
        expect(report).toHaveBeenCalledExactlyOnceWith(failure);
        act(() => store.apply([add(sdkEntry("d"))]));
        expect(listedIds()).toEqual(["c", "d"]);
        expect(selectedIds()).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("keeps a selection restored before its entry arrives, then shows it", () => {
      const onSelectionChange = vi.fn();
      const store = createViewerStore();
      render(
        <TraceViewer
          store={store}
          selection={{ entryId: "x" }}
          onSelectionChange={onSelectionChange}
        />,
      );
      act(() => store.apply([add(sdkEntry("a"))]));
      act(() => store.apply([add(sdkEntry("x"))]));
      expect(onSelectionChange).not.toHaveBeenCalled();
      expect(selectedIds()).toEqual(["x"]);
    });

    it("clears once a selection not arrived yet when the store is cleared", () => {
      const onSelectionChange = vi.fn();
      const store = storeWith(ENTRIES);
      render(
        <TraceViewer
          store={store}
          defaultSelection={{ entryId: "x" }}
          onSelectionChange={onSelectionChange}
        />,
      );
      act(() => store.apply([add(sdkEntry("d"))]));
      act(() => store.clear());
      act(() => store.apply([add(sdkEntry("x"))]));
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ entryId: null });
      expect(selectedIds()).toEqual([]);
    });

    it("keeps the selection of a pending entry dropped while paused", () => {
      const onSelectionChange = vi.fn();
      const store = storeWith([sdkEntry("a")], 2);
      render(
        <TraceViewer
          store={store}
          defaultSelection={{ entryId: "x" }}
          onSelectionChange={onSelectionChange}
        />,
      );
      act(() => store.pause());
      act(() => store.apply([add(sdkEntry("x"))]));
      act(() => store.apply([add(sdkEntry("y"))]));
      expect(store.getStats().droppedPending).toBe(1);
      act(() => store.resume());
      expect(store.get("x")).toBeUndefined();
      expect(onSelectionChange).not.toHaveBeenCalled();
      act(() => store.apply([add(sdkEntry("x"))]));
      expect(selectedIds()).toEqual(["x"]);
    });

    it("follows a controlled selection and announces an eviction once", () => {
      const onSelectionChange = vi.fn();
      const store = storeWith(ENTRIES.slice(0, 2), 2);
      const { rerender } = render(
        <TraceViewer
          store={store}
          selection={{ entryId: "a" }}
          onSelectionChange={onSelectionChange}
        />,
      );
      fireEvent.click(row("b"));
      expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ entryId: "b" });
      expect(selectedIds()).toEqual(["a"]);

      // The parent ignores the callback: the evicted entry stays the selection.
      act(() => store.apply([add(sdkEntry("c"))]));
      act(() => store.apply([add(sdkEntry("d"))]));
      act(() => store.apply([add(sdkEntry("e"))]));
      expect(onSelectionChange).toHaveBeenCalledTimes(2);
      expect(onSelectionChange).toHaveBeenLastCalledWith({ entryId: null });

      rerender(<TraceViewer store={store} selection={{ entryId: "e" }} />);
      expect(selectedIds()).toEqual(["e"]);
    });

    it("lets a parent drive the selection", () => {
      function Parent(): ReactElement {
        const [selection, setSelection] = useState<ViewerSelection>({ entryId: null });
        return (
          <>
            <button type="button" onClick={() => setSelection({ entryId: "c" })}>
              pick c
            </button>
            <TraceViewer store={store} selection={selection} onSelectionChange={setSelection} />
          </>
        );
      }
      const store = storeWith(ENTRIES);
      render(<Parent />);
      fireEvent.click(screen.getByRole("button", { name: "pick c" }));
      expect(selectedIds()).toEqual(["c"]);
      fireEvent.click(row("a"));
      expect(selectedIds()).toEqual(["a"]);
    });
  });

  it("renders, filters and reports each selection change once under StrictMode", () => {
    const onSelectionChange = vi.fn();
    const store = storeWith(ENTRIES, 3);
    render(
      <StrictMode>
        <TraceViewer store={store} onSelectionChange={onSelectionChange} />
      </StrictMode>,
    );
    expect(listedIds()).toEqual(["a", "b", "c"]);

    fireEvent.click(chargePoint("CP-2 (1)"));
    expect(listedIds()).toEqual(["b"]);
    fireEvent.click(chargePoint("CP-2 (1)"));
    expect(listedIds()).toEqual(["a", "b", "c"]);

    fireEvent.click(row("a"));
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith({ entryId: "a" });
    act(() => store.apply([add(sdkEntry("d"))]));
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ entryId: null });
    expect(listedIds()).toEqual(["b", "c", "d"]);
    expect(selectedIds()).toEqual([]);
  });

  it("stays bounded under a sustained stream", () => {
    const store = createViewerStore({ maxEntries: 2000 });
    let commits = 0;
    render(
      <Profiler id="viewer" onRender={() => commits++}>
        <TraceViewer store={store} />
      </Profiler>,
    );
    let next = 0;
    for (let batch = 0; batch < 100; batch++) {
      const before = commits;
      act(() =>
        store.apply(
          Array.from({ length: 50 }, () => add(sdkEntry(`s${next++}`, { connectorId: batch % 3 }))),
        ),
      );
      fireEvent.scroll(screen.getByRole("grid"));
      expect(commits - before).toBeLessThanOrEqual(3);
      expect(store.size).toBeLessThanOrEqual(2000);
      expect(listedIds().length).toBeLessThanOrEqual(VIEWPORT_ROWS + 2 * 8 + 1);
    }
    expect(store.size).toBe(2000);
    expect(listedIds()).toContain(`s${next - 1}`);
  });
});
