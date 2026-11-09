import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createFilterEngine,
  createViewerStore,
  type FilterEngine,
  type FilterEngineOptions,
  type TraceFilter,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { FilterPanel, type FilterPanelProps } from "@open-ocpp-trace/viewer-react";
import { add, sdkEntry } from "./fixtures.ts";

function connected(
  entries: ViewerEntry[],
  options: FilterEngineOptions = {},
): { store: ViewerStore; engine: FilterEngine } {
  const store = createViewerStore();
  store.load(entries);
  const engine = createFilterEngine(options);
  engine.connect(store);
  return { store, engine };
}

function connectedEngine(...entries: ViewerEntry[]): FilterEngine {
  return connected(entries).engine;
}

function group(legend: string): HTMLElement {
  return screen.getByRole("group", { name: legend });
}

function checkbox(legend: string, name: string): HTMLInputElement {
  return within(group(legend)).getByRole<HTMLInputElement>("checkbox", { name });
}

function clearButton(legend: string): HTMLElement {
  return within(group(legend)).getByRole("button", { name: `Clear ${legend}` });
}

const ENTRIES = [
  sdkEntry("a", { connectorId: 1 }),
  sdkEntry("b", { chargePointId: "CP-2", connectorId: 2, action: "Authorize" }),
  sdkEntry("c", { chargePointId: undefined, direction: "csms-to-cp", messageType: "CALLRESULT" }),
  { kind: "gap", id: "g", reason: "disconnected" },
] satisfies ViewerEntry[];

describe("<FilterPanel> controls", () => {
  it("lists the observed values of a group with their counts, (none) for the absent value", () => {
    render(<FilterPanel engine={connectedEngine(...ENTRIES)} />);
    const names = within(group("Charge points"))
      .getAllByRole("checkbox")
      .map((box) => box.parentElement?.textContent);
    expect(names).toEqual(["(none) (2)", "CP-1 (1)", "CP-2 (1)"]);
    expect(checkbox("Kinds", "Traces (3)")).toBeDefined();
    expect(checkbox("Kinds", "Gaps (1)")).toBeDefined();
    expect(checkbox("Kinds", "Unparsed (0)")).toBeDefined();
  });

  it("selects values, keeps numbers and null typed, and clears a group", async () => {
    const user = userEvent.setup();
    const engine = connectedEngine(...ENTRIES);
    render(<FilterPanel engine={engine} />);

    await user.click(checkbox("Charge points", "CP-2 (1)"));
    await user.click(checkbox("Charge points", "(none) (2)"));
    expect(engine.filter).toEqual({ chargePointIds: ["CP-2", null] });
    expect(checkbox("Charge points", "CP-2 (1)").checked).toBe(true);

    await user.click(checkbox("Charge points", "CP-2 (1)"));
    expect(engine.filter).toEqual({ chargePointIds: [null] });
    await user.click(checkbox("Charge points", "(none) (2)"));
    expect(engine.filter).toEqual({});

    await user.click(checkbox("Connectors", "2 (1)"));
    expect(engine.filter).toEqual({ connectorIds: [2] });
    await user.click(clearButton("Connectors"));
    expect(engine.filter).toEqual({});
  });

  it.each([
    ["Kinds", "Gaps (1)", { kinds: ["gap"] }],
    ["OCPP versions", "1.6 (3)", { ocppVersions: ["1.6"] }],
    ["Directions", "csms-to-cp (1)", { directions: ["csms-to-cp"] }],
    ["Message types", "CALLRESULT (1)", { messageTypes: ["CALLRESULT"] }],
    ["Actions", "Authorize (1)", { actions: ["Authorize"] }],
    ["Sessions", "(none) (4)", { sessionIds: [null] }],
    ["Tenants", "(none) (4)", { tenants: [null] }],
    ["Sources", "(none) (4)", { sourceIds: [null] }],
    ["Delivery statuses", "(none) (4)", { deliveryStatuses: [null] }],
  ])("operates and clears the %s group", async (legend, name, expected) => {
    const user = userEvent.setup();
    const engine = connectedEngine(...ENTRIES);
    render(<FilterPanel engine={engine} />);
    await user.click(checkbox(legend, name));
    expect(engine.filter).toEqual(expected);
    await user.click(clearButton(legend));
    expect(engine.filter).toEqual({});
  });

  it("keeps a selected value listed once it is no longer observed", () => {
    render(<FilterPanel engine={connectedEngine(...ENTRIES)} filter={{ actions: ["Ghost"] }} />);
    expect(checkbox("Actions", "Ghost (0)").checked).toBe(true);
  });

  it("labels producer fields and filters on them", async () => {
    const user = userEvent.setup();
    const fields = [
      {
        id: "site",
        label: "Site",
        values: (entry: ViewerEntry) => (entry.id === "a" ? ["Lyon"] : []),
      },
    ];
    const { engine } = connected(ENTRIES, { fields });
    render(<FilterPanel engine={engine} fields={fields} />);
    await user.click(checkbox("Site", "Lyon (1)"));
    expect(engine.filter).toEqual({ fields: [{ id: "site", values: ["Lyon"] }] });
    expect(engine.size).toBe(2); // the gap is kept
    await user.click(clearButton("Site"));
    expect(engine.filter).toEqual({});
  });

  it("filters on a time range typed as RFC 3339, an empty bound removing it", async () => {
    const user = userEvent.setup();
    const engine = connectedEngine(...ENTRIES);
    render(<FilterPanel engine={engine} />);
    const from = within(group("Time range")).getByRole<HTMLInputElement>("textbox", {
      name: "From",
    });
    const to = within(group("Time range")).getByRole<HTMLInputElement>("textbox", { name: "To" });

    await user.type(from, "2026-11-09T09:00:00Z");
    expect(engine.filter).toEqual({});
    await user.tab();
    expect(engine.filter).toEqual({ timeRange: { from: "2026-11-09T09:00:00Z" } });
    await user.type(to, "2026-11-09T11:00:00Z{Enter}");
    expect(engine.filter).toEqual({
      timeRange: { from: "2026-11-09T09:00:00Z", to: "2026-11-09T11:00:00Z" },
    });

    await user.clear(from);
    await user.tab();
    expect(engine.filter).toEqual({ timeRange: { to: "2026-11-09T11:00:00Z" } });
    await user.click(clearButton("Time range"));
    expect(engine.filter).toEqual({});
    expect(to.value).toBe("");
  });

  it("shows an alert for a time bound the engine rejects", async () => {
    const user = userEvent.setup();
    const engine = connectedEngine(...ENTRIES);
    render(<FilterPanel engine={engine} />);
    await user.type(within(group("Time range")).getByRole("textbox", { name: "From" }), "soon");
    await user.tab();
    expect(screen.getByRole("alert").textContent).toContain("The filter is invalid");
    expect(engine.filter).toEqual({});
  });

  it("filters on exact message IDs separated by commas or spaces", async () => {
    const user = userEvent.setup();
    const engine = connectedEngine(...ENTRIES);
    render(<FilterPanel engine={engine} />);
    const input = within(group("Message IDs")).getByRole<HTMLInputElement>("textbox", {
      name: "Message IDs",
    });
    await user.type(input, "m-a, m-b{Enter}");
    expect(engine.filter).toEqual({ messageIds: ["m-a", "m-b"] });
    await user.click(clearButton("Message IDs"));
    expect(engine.filter).toEqual({});
    expect(input.value).toBe("");
  });

  it("searches text, in payloads only when the panel offers it", async () => {
    const user = userEvent.setup();
    const { engine } = connected(ENTRIES, { payloadSearch: true });
    const { rerender } = render(<FilterPanel engine={engine} />);
    expect(screen.queryByRole("checkbox", { name: "Search payloads" })).toBeNull();

    rerender(<FilterPanel engine={engine} payloadSearch />);
    await user.type(within(group("Search")).getByRole("searchbox", { name: "Text" }), "boot");
    await user.click(within(group("Search")).getByRole("checkbox", { name: "Search payloads" }));
    expect(engine.filter).toEqual({ text: "boot", searchPayloads: true });
    await user.click(clearButton("Search"));
    expect(engine.filter).toEqual({});
  });

  it("resets every group at once", async () => {
    const user = userEvent.setup();
    const engine = connectedEngine(...ENTRIES);
    render(
      <FilterPanel
        engine={engine}
        defaultFilter={{ kinds: ["trace"], actions: ["Authorize"], text: "x", messageIds: ["m-a"] }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(engine.filter).toEqual({});
    expect(screen.queryAllByRole("checkbox", { checked: true })).toEqual([]);
  });

  it("updates the counts when the store changes", () => {
    const { store, engine } = connected(ENTRIES);
    render(<FilterPanel engine={engine} />);
    act(() => store.apply([add(sdkEntry("d", { chargePointId: "CP-2" }))]));
    expect(checkbox("Charge points", "CP-2 (2)")).toBeDefined();
  });

  it("keeps the focus on its value when a new value sorts before it", () => {
    const { store, engine } = connected([
      sdkEntry("a", { chargePointId: "CP-2" }),
      sdkEntry("b", { chargePointId: "CP-3" }),
    ]);
    render(<FilterPanel engine={engine} />);
    act(() => checkbox("Charge points", "CP-3 (1)").focus());
    act(() => store.apply([add(sdkEntry("c", { chargePointId: "CP-1" }))]));
    expect(document.activeElement).toBe(checkbox("Charge points", "CP-3 (1)"));
  });

  it("renders hostile observed values as text", () => {
    const hostile = '<img src="x" onerror="alert(1)">';
    render(
      <FilterPanel
        engine={connectedEngine(
          sdkEntry("a", { chargePointId: hostile }),
          sdkEntry("b", { chargePointId: "__proto__" }),
        )}
      />,
    );
    expect(checkbox("Charge points", `${hostile} (1)`)).toBeDefined();
    expect(checkbox("Charge points", "__proto__ (1)")).toBeDefined();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("<FilterPanel> filter state", () => {
  it("pushes a controlled filter into the engine", () => {
    const engine = connectedEngine(sdkEntry("a"), sdkEntry("b", { action: "Authorize" }));
    const { rerender } = render(
      <FilterPanel engine={engine} filter={{ actions: ["Authorize"] }} />,
    );
    expect(engine.filter).toEqual({ actions: ["Authorize"] });
    expect(engine.size).toBe(1);

    rerender(<FilterPanel engine={engine} filter={{}} />);
    expect(engine.filter).toEqual({});
    expect(engine.size).toBe(2);
  });

  it("does not re-filter for a fresh but equal object on every render", () => {
    const engine = connectedEngine(sdkEntry("a"));
    const setFilter = vi.spyOn(engine, "setFilter");
    const { rerender } = render(<FilterPanel engine={engine} filter={{ actions: ["A"] }} />);
    rerender(<FilterPanel engine={engine} filter={{ actions: ["A"] }} />);
    // A JavaScript host may leave undefined properties behind.
    const sparse = { actions: ["A"], text: undefined } as unknown as TraceFilter;
    rerender(<FilterPanel engine={engine} filter={sparse} />);
    expect(setFilter).toHaveBeenCalledTimes(1);
  });

  it("starts an uncontrolled panel from defaultFilter, else from the engine", () => {
    const engine = connectedEngine(sdkEntry("a"));
    render(<FilterPanel engine={engine} defaultFilter={{ kinds: ["gap"] }} />);
    expect(engine.filter).toEqual({ kinds: ["gap"] });
    expect(engine.size).toBe(0);
  });

  it("keeps the engine's filter when no initial filter is given", () => {
    const engine = connectedEngine(sdkEntry("a"));
    engine.setFilter({ kinds: ["trace"] });
    const setFilter = vi.spyOn(engine, "setFilter");
    render(<FilterPanel engine={engine} />);
    expect(setFilter).not.toHaveBeenCalled();
    expect(engine.filter).toEqual({ kinds: ["trace"] });
  });

  it("applies a reset in uncontrolled mode and reports it", () => {
    const engine = connectedEngine(sdkEntry("a"));
    const onFilterChange = vi.fn();
    render(
      <FilterPanel
        engine={engine}
        defaultFilter={{ kinds: ["gap"] }}
        onFilterChange={onFilterChange}
      />,
    );
    act(() => screen.getByRole("button", { name: "Reset" }).click());
    expect(onFilterChange).toHaveBeenCalledWith({});
    expect(engine.filter).toEqual({});
  });

  it("only reports an edit in controlled mode, the parent applying it", () => {
    const engine = connectedEngine(sdkEntry("a"));
    const onFilterChange = vi.fn();
    render(
      <FilterPanel engine={engine} filter={{ kinds: ["gap"] }} onFilterChange={onFilterChange} />,
    );
    act(() => screen.getByRole("button", { name: "Reset" }).click());
    expect(onFilterChange).toHaveBeenCalledWith({});
    expect(engine.filter).toEqual({ kinds: ["gap"] });
  });

  it("follows the parent that applies the reported filter", () => {
    const engine = connectedEngine(sdkEntry("a"));
    function Parent(): ReactElement {
      const [filter, setFilter] = useState<TraceFilter>({ kinds: ["gap"] });
      const props: FilterPanelProps = { engine, filter, onFilterChange: setFilter };
      return <FilterPanel {...props} />;
    }
    render(<Parent />);
    act(() => screen.getByRole("button", { name: "Reset" }).click());
    expect(engine.filter).toEqual({});
  });

  it.each([
    ["an unknown property", { colour: "red" }],
    ["a list that is not an array", { fields: "x", chargePointIds: "CP-1", kinds: 5 }],
    ["a time range that is not an object", { timeRange: 5, text: 3 }],
    ["an unparsable time bound", { timeRange: { from: "not a date" } }],
  ])("shows an alert for %s and keeps the engine unchanged", (_, malformed) => {
    const engine = connectedEngine(sdkEntry("a"));
    engine.setFilter({ kinds: ["trace"] });
    const { rerender } = render(
      <FilterPanel engine={engine} filter={malformed as unknown as TraceFilter} />,
    );
    expect(screen.getByRole("alert").textContent).toContain("The filter is invalid");
    expect(engine.filter).toEqual({ kinds: ["trace"] });

    rerender(<FilterPanel engine={engine} filter={{}} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(engine.filter).toEqual({});
  });
});
