import { act, render, screen } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createFilterEngine,
  createViewerStore,
  type FilterEngine,
  type TraceFilter,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";

import { FilterPanel } from "../src/FilterPanel.tsx";
import { sdkEntry } from "./fixtures.ts";

function connectedEngine(...entries: ViewerEntry[]): FilterEngine {
  const store = createViewerStore();
  store.load(entries);
  const engine = createFilterEngine();
  engine.connect(store);
  return engine;
}

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
      return <FilterPanel engine={engine} filter={filter} onFilterChange={setFilter} />;
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
