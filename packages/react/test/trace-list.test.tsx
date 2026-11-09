import { act, render, screen, within } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  type ColumnDefinition,
  type Correlator,
  createCorrelator,
  createViewerStore,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { TraceList, type TraceListProps, useFilterEngine } from "@open-ocpp-trace/viewer-react";

import { add, sdkEntry } from "./fixtures.ts";

const ROW_HEIGHT = 28;
const VIEWPORT_ROWS = 10;

// happy-dom does no layout: every clientHeight is 0, so the virtualizer,
// which reads the scroll element's clientHeight on mount, would render no
// row. Give elements a fixed size instead; `initialRect` would not help, as
// that first read replaces it.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => ROW_HEIGHT * VIEWPORT_ROWS,
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 800,
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

type ListProps = Omit<TraceListProps, "engine">;

function Harness(props: { store: ViewerStore; correlator?: Correlator } & ListProps): ReactElement {
  const { store, correlator, ...list } = props;
  const engine = useFilterEngine(store, correlator === undefined ? undefined : { correlator });
  return <TraceList engine={engine} {...(correlator !== undefined && { correlator })} {...list} />;
}

function storeWith(...entries: ViewerEntry[]): ViewerStore {
  const store = createViewerStore();
  store.load(entries);
  return store;
}

/** The entry rows, without the header row. */
function entryRows(): HTMLElement[] {
  return screen.getAllByRole("row").filter((row) => row.hasAttribute("data-entry-id"));
}

function rowOf(id: string): HTMLElement {
  const row = entryRows().find((candidate) => candidate.dataset["entryId"] === id);
  if (row === undefined) throw new Error(`no row for ${id}`);
  return row;
}

function cellTexts(row: HTMLElement): string[] {
  return within(row)
    .getAllByRole("gridcell")
    .map((cell) => cell.textContent ?? "");
}

describe("<TraceList>", () => {
  it("renders the store's SDK records and follows incremental updates", () => {
    const store = storeWith(
      sdkEntry("a", { action: "BootNotification", connectorId: 0 }),
      sdkEntry("b", { chargePointId: undefined, connectorId: 2 }),
    );
    render(<Harness store={store} />);

    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Timestamp",
      "Charge point",
      "Connector",
      "Direction",
      "Type",
      "Action",
      "Message ID",
    ]);
    expect(cellTexts(rowOf("a"))).toEqual([
      "2026-11-09T10:00:00.000Z",
      "CP-1",
      "0",
      "cp-to-csms",
      "CALL",
      "BootNotification",
      "m-a",
    ]);
    expect(cellTexts(rowOf("b"))[1]).toBe("");

    act(() => store.apply([add(sdkEntry("c"))]));
    expect(entryRows().map((row) => row.dataset["entryId"])).toEqual(["a", "b", "c"]);

    const before = rowOf("b");
    act(() => store.apply([{ type: "update", id: "b", metadata: { chargePointId: "CP-META" } }]));
    expect(rowOf("b")).toBe(before);
    expect(cellTexts(before)[1]).toBe("CP-META");
  });

  it("keys rows by entry id when older entries are evicted", () => {
    const store = createViewerStore({ maxEntries: 2 });
    store.load([sdkEntry("a"), sdkEntry("b")]);
    render(<Harness store={store} />);
    const before = rowOf("b");
    act(() => store.apply([add(sdkEntry("c"))]));
    expect(entryRows().map((row) => row.dataset["entryId"])).toEqual(["b", "c"]);
    expect(rowOf("b")).toBe(before);
    expect(before.getAttribute("aria-rowindex")).toBe("2");
  });

  it("shows the action the correlator derives for a response", () => {
    const store = createViewerStore();
    const correlator = createCorrelator();
    correlator.connect(store);
    store.load([
      sdkEntry("call", { action: "Authorize", messageId: "m-1" }),
      sdkEntry("result", {
        direction: "csms-to-cp",
        messageType: "CALLRESULT",
        messageId: "m-1",
        action: undefined,
      }),
    ]);
    render(<Harness store={store} correlator={correlator} />);
    expect(cellTexts(rowOf("result"))[5]).toBe("Authorize");
  });

  it("renders only the visible rows of a long list", () => {
    const entries = Array.from({ length: 1000 }, (_, i) => sdkEntry(`e${i}`));
    render(<Harness store={storeWith(...entries)} />);
    const rendered = entryRows().length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(100);
    expect(screen.getByRole("grid").getAttribute("aria-rowcount")).toBe("1001");
  });

  it("appends host columns and renders their values as text", () => {
    const columns: ColumnDefinition[] = [
      { id: "s", label: "Text", value: () => "hello" },
      { id: "n", label: "Number", value: () => 42 },
      { id: "b", label: "Flag", value: () => false },
      { id: "u", label: "Nothing", value: () => undefined },
      {
        id: "t",
        label: "Throws",
        value: () => {
          throw new Error("boom");
        },
      },
    ];
    render(<Harness store={storeWith(sdkEntry("a"))} columns={columns} />);
    expect(
      screen
        .getAllByRole("columnheader")
        .slice(7)
        .map((cell) => cell.textContent),
    ).toEqual(["Text", "Number", "Flag", "Nothing", "Throws"]);
    expect(cellTexts(rowOf("a")).slice(7)).toEqual(["hello", "42", "false", "", ""]);
  });

  it("marks gap and unparsed rows by text and class", () => {
    const store = storeWith(
      { kind: "gap", id: "g1", reason: "disconnected", missedCount: 12 },
      { kind: "gap", id: "g2", reason: "dropped" },
      { kind: "gap", id: "g3", reason: "unknown", missedCount: 1 },
      {
        kind: "unparsed",
        id: "u",
        raw: `[2,"x",${"y".repeat(500)}`,
        reason: "invalid JSON",
        direction: "csms-to-cp",
        timestamp: "2026-11-09T10:00:00.000Z",
      },
    );
    render(<Harness store={store} />);

    const gap = rowOf("g1");
    expect(gap.className).toContain("oot-row--gap");
    expect(gap.textContent).toBe("Gap: 12 entries missed (disconnected)");
    expect(within(gap).getByRole("gridcell").getAttribute("aria-colspan")).toBe("7");
    expect(rowOf("g2").textContent).toBe("Gap (dropped)");
    expect(rowOf("g3").textContent).toBe("Gap: 1 entry missed (unknown)");

    const unparsed = rowOf("u");
    expect(unparsed.className).toContain("oot-row--unparsed");
    expect(within(unparsed).getByText("Unparsed")).toBeTruthy();
    expect(unparsed.textContent).toContain("invalid JSON");
    expect(unparsed.textContent).toContain("csms-to-cp");
    expect(unparsed.textContent).toContain('[2,"x",yyy');
    expect(unparsed.textContent!.length).toBeLessThan(400);
  });

  it("renders hostile trace content as text", () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const store = storeWith(
      sdkEntry("a", { action: hostile, chargePointId: hostile }),
      { kind: "unparsed", id: "u", raw: hostile, reason: hostile },
      { kind: "gap", id: "g", reason: hostile },
    );
    const { container } = render(<Harness store={store} />);
    expect(container.querySelector("img")).toBeNull();
    expect(cellTexts(rowOf("a"))[5]).toBe(hostile);
    expect(rowOf("u").textContent).toContain(hostile);
    expect(rowOf("g").textContent).toContain(hostile);
  });

  it("exposes grid semantics with ids that do not derive from entry ids", () => {
    const store = storeWith(sdkEntry("first"), sdkEntry("second"));
    render(<Harness store={store} aria-label="Frames" />);
    const grid = screen.getByRole("grid", { name: "Frames" });
    expect(grid.getAttribute("aria-rowcount")).toBe("3");
    const header = screen.getAllByRole("row")[0]!;
    expect(header.getAttribute("aria-rowindex")).toBe("1");
    expect(rowOf("first").getAttribute("aria-rowindex")).toBe("2");
    expect(rowOf("second").getAttribute("aria-rowindex")).toBe("3");
    const ids = entryRows().map((row) => row.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).not.toBe("");
      expect(id).not.toContain("first");
      expect(id).not.toContain("second");
    }
  });

  it("has a default accessible name", () => {
    render(<Harness store={createViewerStore()} />);
    expect(screen.getByRole("grid", { name: "Trace entries" })).toBeTruthy();
  });

  describe("states", () => {
    it("shows the host error as an alert", () => {
      render(<Harness store={storeWith(sdkEntry("a"))} error="Connection lost" />);
      expect(screen.getByRole("alert").textContent).toBe("Connection lost");
      expect(entryRows()).toHaveLength(1);
    });

    it("shows loading while nothing is listed", () => {
      render(<Harness store={createViewerStore()} loading />);
      expect(screen.getByRole("status").textContent).toBe("Loading entries…");
    });

    it("shows that the store is empty", () => {
      render(<Harness store={createViewerStore()} />);
      expect(screen.getByText("No entries")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("tells hidden entries apart from an empty store", () => {
      function Filtered(): ReactElement {
        const engine = useFilterEngine(storeRef);
        return (
          <>
            <button type="button" onClick={() => engine.setFilter({ chargePointIds: ["none"] })}>
              filter
            </button>
            <TraceList engine={engine} />
          </>
        );
      }
      const storeRef = storeWith(sdkEntry("a"));
      render(<Filtered />);
      act(() => screen.getByRole("button").click());
      expect(entryRows()).toHaveLength(0);
      expect(screen.getByText("No entries match the filter")).toBeTruthy();
    });
  });
});

describe("useFilterEngine", () => {
  it("connects under StrictMode", () => {
    render(
      <StrictMode>
        <Harness store={storeWith(sdkEntry("a"), sdkEntry("b"))} />
      </StrictMode>,
    );
    expect(entryRows()).toHaveLength(2);
  });

  it("follows a new store", () => {
    const { rerender } = render(<Harness store={storeWith(sdkEntry("a"))} />);
    rerender(<Harness store={storeWith(sdkEntry("x"), sdkEntry("y"))} />);
    expect(entryRows().map((row) => row.dataset["entryId"])).toEqual(["x", "y"]);
  });
});
