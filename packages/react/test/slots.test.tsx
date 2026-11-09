import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type FilterFieldDefinition,
  type TraceFilter,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import {
  type DetailPanel,
  type DetailPanelContext,
  FilterPanel,
  type FilterControl,
  type FilterControlContext,
  type ToolbarAction,
  TraceViewer,
  useFilterEngine,
  type ViewerActionContext,
} from "@open-ocpp-trace/viewer-react";

import { sdkEntry } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

afterEach(() => {
  vi.unstubAllGlobals();
});

function storeWith(entries: ViewerEntry[]): ViewerStore {
  const store = createViewerStore();
  store.load(entries);
  return store;
}

function listedIds(): string[] {
  return within(screen.getByRole("grid"))
    .getAllByRole("row")
    .flatMap((row) => (row.dataset["entryId"] === undefined ? [] : [row.dataset["entryId"]]));
}

function row(id: string): HTMLElement {
  const found = within(screen.getByRole("grid"))
    .getAllByRole("row")
    .find((candidate) => candidate.dataset["entryId"] === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

const ENTRIES = [
  sdkEntry("a"),
  sdkEntry("b", { chargePointId: "CP-2" }),
  sdkEntry("c", { action: "Authorize" }),
];

describe("toolbar actions", () => {
  it("renders host actions after the built-in buttons", () => {
    const actions: ToolbarAction[] = [
      { id: "one", label: "Host one", run: () => {} },
      { id: "two", label: "Host two", run: () => {} },
    ];
    const { container } = render(
      <TraceViewer store={storeWith(ENTRIES)} toolbarActions={actions} onExport={() => {}} />,
    );
    const toolbar = container.querySelector(".oot-toolbar")!;
    const buttons = [...toolbar.querySelectorAll("button")].map((button) => button.textContent);
    expect(buttons).toEqual([
      "Pause",
      "Follow latest",
      "Export selection",
      "Export filtered",
      "Host one",
      "Host two",
    ]);
    const host = screen.getByRole("button", { name: "Host one" });
    expect(host.getAttribute("type")).toBe("button");
    expect(host.className).toBe("oot-toolbar-button");
  });

  it("runs an action with the selection and the listed entries, in order", () => {
    const seen: { selection: unknown; selected: string | undefined; listed: string[] }[] = [];
    const run = vi.fn((context: ViewerActionContext) => {
      seen.push({
        selection: context.selection,
        selected: context.selectedEntry?.id,
        listed: context.listed().map((entry) => entry.id),
      });
    });
    const store = storeWith(ENTRIES);
    render(
      <TraceViewer
        store={store}
        toolbarActions={[{ id: "act", label: "Act", run }]}
        defaultFilter={{ chargePointIds: ["CP-1"] }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Act" }));
    fireEvent.click(row("c"));
    fireEvent.click(screen.getByRole("button", { name: "Act" }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]![0].store).toBe(store);
    expect(seen).toEqual([
      { selection: { entryId: null }, selected: undefined, listed: ["a", "c"] },
      { selection: { entryId: "c" }, selected: "c", listed: ["a", "c"] },
    ]);
  });

  it("returns a fresh array from listed() on every call", () => {
    let first: ViewerEntry[] = [];
    let second: ViewerEntry[] = [];
    const run = (context: ViewerActionContext): void => {
      first = context.listed();
      second = context.listed();
    };
    render(
      <TraceViewer store={storeWith(ENTRIES)} toolbarActions={[{ id: "a", label: "A", run }]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("selects an entry from an action", () => {
    const onSelectionChange = vi.fn();
    const action: ToolbarAction = {
      id: "last",
      label: "Select last",
      run: (context) => context.select(context.listed().at(-1)?.id ?? null),
    };
    render(
      <TraceViewer
        store={storeWith(ENTRIES)}
        toolbarActions={[action]}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Select last" }));
    expect(row("c").getAttribute("aria-selected")).toBe("true");
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0]![0]).toEqual({ entryId: "c" });
  });

  it("evaluates disabled on every render", () => {
    const action: ToolbarAction = {
      id: "needs-selection",
      label: "Needs selection",
      disabled: (context) => context.selectedEntry === undefined,
      run: () => {},
    };
    render(<TraceViewer store={storeWith(ENTRIES)} toolbarActions={[action]} />);
    const button = (): HTMLButtonElement =>
      screen.getByRole("button", { name: "Needs selection" }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    fireEvent.click(row("b"));
    expect(button().disabled).toBe(false);
  });

  it("reports a throwing run and stays usable", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const failure = new Error("action failure");
    const action: ToolbarAction = {
      id: "boom",
      label: "Boom",
      run: () => {
        throw failure;
      },
    };
    render(<TraceViewer store={storeWith(ENTRIES)} toolbarActions={[action]} />);
    fireEvent.click(screen.getByRole("button", { name: "Boom" }));
    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    fireEvent.click(row("b"));
    expect(row("b").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Boom" })).toBeDefined();
  });

  it("reports a throwing disabled, disables the action and stays usable", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const failure = new Error("disabled failure");
    const run = vi.fn();
    const action: ToolbarAction = {
      id: "broken",
      label: "Broken",
      disabled: () => {
        throw failure;
      },
      run,
    };
    render(<TraceViewer store={storeWith(ENTRIES)} toolbarActions={[action]} />);
    const button = screen.getByRole("button", { name: "Broken" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(report).toHaveBeenCalledWith(failure);
    fireEvent.click(row("a"));
    expect(row("a").getAttribute("aria-selected")).toBe("true");
  });
});

/** A host control toggling the producer field `zone` to `["north"]`. */
const ZONE_FIELD: FilterFieldDefinition = {
  id: "zone",
  label: "Zone",
  values: (entry) => {
    const zone = entry.metadata?.custom?.["zone"];
    return typeof zone === "string" ? [zone] : [];
  },
};
const ZONE_FIELDS = [ZONE_FIELD];

const ZONE_CONTROL: FilterControl = {
  id: "zone-control",
  label: "Host zone",
  render: (context) => {
    const { filter } = context;
    const others = (filter.fields ?? []).filter((field) => field.id !== "zone");
    const on = others.length !== (filter.fields ?? []).length;
    return (
      <label>
        <input
          type="checkbox"
          checked={on}
          onChange={() =>
            context.setFilter({
              ...filter,
              fields: on ? others : [...others, { id: "zone", values: ["north"] }],
            })
          }
        />
        North only
      </label>
    );
  },
};

const ZONED = [sdkEntry("n1"), sdkEntry("s1"), sdkEntry("n2")].map((entry, index): ViewerEntry => ({
  ...entry,
  metadata: { custom: { zone: index === 1 ? "south" : "north" } },
}));

function hostGroup(): HTMLElement {
  return screen.getByRole("group", { name: "Host zone" });
}

describe("filter controls", () => {
  it("renders host controls after the built-in groups, in a host fieldset", () => {
    const { container } = render(
      <TraceViewer store={storeWith(ZONED)} fields={ZONE_FIELDS} filterControls={[ZONE_CONTROL]} />,
    );
    const groups = [...container.querySelectorAll(".oot-filter fieldset")];
    expect(groups.at(-1)).toBe(hostGroup());
    expect(hostGroup().className).toBe("oot-filter-group oot-filter-group--host");
    expect(hostGroup().querySelector("legend")?.textContent).toBe("Host zone");
  });

  it("filters the list through a host control, uncontrolled", () => {
    const onFilterChange = vi.fn();
    render(
      <TraceViewer
        store={storeWith(ZONED)}
        fields={ZONE_FIELDS}
        filterControls={[ZONE_CONTROL]}
        onFilterChange={onFilterChange}
      />,
    );
    expect(listedIds()).toEqual(["n1", "s1", "n2"]);
    fireEvent.click(within(hostGroup()).getByRole("checkbox", { name: "North only" }));
    expect(listedIds()).toEqual(["n1", "n2"]);
    expect(onFilterChange).toHaveBeenCalledExactlyOnceWith({
      fields: [{ id: "zone", values: ["north"] }],
    });
    fireEvent.click(within(hostGroup()).getByRole("checkbox", { name: "North only" }));
    expect(listedIds()).toEqual(["n1", "s1", "n2"]);
  });

  it("filters the list through a host control, controlled", () => {
    const onFilterChange = vi.fn();
    function Host(): ReactElement {
      const [filter, setFilter] = useState<TraceFilter>({});
      return (
        <TraceViewer
          store={storeWith(ZONED)}
          fields={ZONE_FIELDS}
          filterControls={[ZONE_CONTROL]}
          filter={filter}
          onFilterChange={(next) => {
            onFilterChange(next);
            setFilter(next);
          }}
        />
      );
    }
    render(<Host />);
    fireEvent.click(within(hostGroup()).getByRole("checkbox", { name: "North only" }));
    expect(listedIds()).toEqual(["n1", "n2"]);
    expect(onFilterChange).toHaveBeenCalledExactlyOnceWith({
      fields: [{ id: "zone", values: ["north"] }],
    });
  });

  it("keeps a controlled filter when the host ignores the change", () => {
    const onFilterChange = vi.fn();
    render(
      <TraceViewer
        store={storeWith(ZONED)}
        fields={ZONE_FIELDS}
        filterControls={[ZONE_CONTROL]}
        filter={{}}
        onFilterChange={onFilterChange}
      />,
    );
    fireEvent.click(within(hostGroup()).getByRole("checkbox", { name: "North only" }));
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(listedIds()).toEqual(["n1", "s1", "n2"]);
  });

  it("renders host controls in a standalone <FilterPanel>", () => {
    const onFilterChange = vi.fn();
    const store = storeWith(ZONED);
    function Panel(): ReactElement {
      const engine = useFilterEngine(store, { fields: ZONE_FIELDS });
      return (
        <FilterPanel
          engine={engine}
          fields={ZONE_FIELDS}
          filterControls={[ZONE_CONTROL]}
          onFilterChange={onFilterChange}
        />
      );
    }
    render(<Panel />);
    act(() => {
      fireEvent.click(within(hostGroup()).getByRole("checkbox", { name: "North only" }));
    });
    expect(onFilterChange).toHaveBeenCalledExactlyOnceWith({
      fields: [{ id: "zone", values: ["north"] }],
    });
    expect(within(hostGroup()).getByRole("checkbox", { name: "North only" })).toHaveProperty(
      "checked",
      true,
    );
  });
});

const ERRORED = [
  sdkEntry("call"),
  sdkEntry("error", {
    direction: "csms-to-cp",
    messageType: "CALLERROR",
    action: undefined,
    error: { code: "InternalError", description: "boom" },
  }),
  sdkEntry("other", { action: "Authorize" }),
];

function panel(title: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`section.oot-detail-panel[aria-label="${title}"]`);
}

const ENTRY_PANEL: DetailPanel = {
  id: "entry",
  title: "Host entry",
  render: (context) => <p className="host-entry">{`entry ${context.entry.id}`}</p>,
};

const ERROR_PANEL: DetailPanel = {
  id: "failure",
  title: "Host failure",
  appliesTo: (entry) => entry.kind === "trace" && entry.record.messageType === "CALLERROR",
  render: () => <p>failure details</p>,
};

describe("detail panels", () => {
  it("renders a panel under the inspector for the selected entry", () => {
    const { container } = render(
      <TraceViewer
        store={storeWith(ERRORED)}
        detailPanels={[ENTRY_PANEL]}
        defaultSelection={{ entryId: "call" }}
      />,
    );
    const section = panel("Host entry");
    expect(section).not.toBeNull();
    expect(section!.querySelector("h3")?.textContent).toBe("Host entry");
    expect(section!.textContent).toContain("entry call");
    const detail = container.querySelector(".oot-viewer__detail")!;
    expect(section!.parentElement).toBe(detail);
    expect(detail.lastElementChild).toBe(section);
    expect(detail.children.length).toBeGreaterThan(1);
  });

  it("renders no panel without a present selected entry", () => {
    const { rerender } = render(
      <TraceViewer store={storeWith(ERRORED)} detailPanels={[ENTRY_PANEL]} />,
    );
    expect(panel("Host entry")).toBeNull();
    rerender(
      <TraceViewer
        store={storeWith(ERRORED)}
        detailPanels={[ENTRY_PANEL]}
        selection={{ entryId: "missing" }}
      />,
    );
    expect(panel("Host entry")).toBeNull();
  });

  it("shows a contextual panel only for the entries it applies to", () => {
    render(<TraceViewer store={storeWith(ERRORED)} detailPanels={[ENTRY_PANEL, ERROR_PANEL]} />);
    fireEvent.click(row("call"));
    expect(panel("Host entry")).not.toBeNull();
    expect(panel("Host failure")).toBeNull();
    fireEvent.click(row("error"));
    expect(panel("Host failure")?.textContent).toContain("failure details");
    expect(panel("Host entry")).not.toBeNull();
  });

  it("gives a panel the store, the correlator and the entry", () => {
    const store = storeWith(ERRORED);
    const correlator = createCorrelator();
    correlator.connect(store);
    const seen: DetailPanelContext[] = [];
    const spy: DetailPanel = {
      id: "spy",
      title: "Spy",
      render: (context) => {
        seen.push(context);
        return null;
      },
    };
    render(
      <TraceViewer
        store={store}
        correlator={correlator}
        detailPanels={[spy]}
        defaultSelection={{ entryId: "error" }}
      />,
    );
    const context = seen.at(-1)!;
    expect(context.store).toBe(store);
    expect(context.correlator).toBe(correlator);
    expect(context.entry).toBe(store.get("error"));
  });

  it("isolates a crashing panel and recovers on another entry", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const crashing: DetailPanel = {
        id: "crash",
        title: "Crashing",
        render: (context) => {
          if (context.entry.id === "error") throw new Error("panel failure");
          return <p>{`fine ${context.entry.id}`}</p>;
        },
      };
      render(<TraceViewer store={storeWith(ERRORED)} detailPanels={[crashing, ENTRY_PANEL]} />);
      fireEvent.click(row("error"));
      expect(panel("Crashing")?.querySelector("h3")?.textContent).toBe("Crashing");
      expect(panel("Crashing")?.querySelector(".oot-detail-panel__error")?.textContent).toBe(
        "This panel failed to render.",
      );
      expect(panel("Host entry")?.textContent).toContain("entry error");
      fireEvent.click(row("other"));
      expect(row("other").getAttribute("aria-selected")).toBe("true");
      expect(panel("Crashing")?.textContent).toContain("fine other");
      expect(panel("Crashing")?.querySelector(".oot-detail-panel__error")).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });

  it("localizes the fallback of a crashing panel", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const crashing: DetailPanel = {
        id: "crash",
        title: "Crashing",
        render: () => {
          throw new Error("panel failure");
        },
      };
      render(
        <TraceViewer
          store={storeWith(ERRORED)}
          detailPanels={[crashing]}
          defaultSelection={{ entryId: "call" }}
          strings={{ detailPanelError: "Panneau en échec" }}
        />,
      );
      expect(panel("Crashing")?.querySelector(".oot-detail-panel__error")?.textContent).toBe(
        "Panneau en échec",
      );
    } finally {
      quiet.mockRestore();
    }
  });

  it("reports a throwing appliesTo and hides that panel", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const failure = new Error("appliesTo failure");
    const broken: DetailPanel = {
      id: "broken",
      title: "Broken",
      appliesTo: () => {
        throw failure;
      },
      render: () => <p>never</p>,
    };
    render(<TraceViewer store={storeWith(ERRORED)} detailPanels={[broken, ENTRY_PANEL]} />);
    fireEvent.click(row("call"));
    expect(panel("Broken")).toBeNull();
    expect(panel("Host entry")).not.toBeNull();
    expect(report).toHaveBeenCalledWith(failure);
  });

  it("selects another entry from a panel", () => {
    const onSelectionChange = vi.fn();
    const navigator: DetailPanel = {
      id: "nav",
      title: "Navigator",
      render: (context) => (
        <button type="button" onClick={() => context.select("other")}>
          Go to other
        </button>
      ),
    };
    render(
      <TraceViewer
        store={storeWith(ERRORED)}
        detailPanels={[navigator]}
        defaultSelection={{ entryId: "call" }}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to other" }));
    expect(row("other").getAttribute("aria-selected")).toBe("true");
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0]![0]).toEqual({ entryId: "other" });
  });
});

describe("selection callback", () => {
  it("passes the selected entry, uncontrolled", () => {
    const store = storeWith(ENTRIES);
    const onSelectionChange = vi.fn();
    render(<TraceViewer store={store} onSelectionChange={onSelectionChange} />);
    fireEvent.click(row("b"));
    expect(onSelectionChange.mock.calls).toEqual([[{ entryId: "b" }, store.get("b")]]);
  });

  it("passes the selected entry, controlled", () => {
    const store = storeWith(ENTRIES);
    const onSelectionChange = vi.fn();
    render(
      <TraceViewer
        store={store}
        selection={{ entryId: null }}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(row("c"));
    expect(onSelectionChange.mock.calls).toEqual([[{ entryId: "c" }, store.get("c")]]);
  });

  it("passes undefined when the selected entry leaves the store", () => {
    const store = storeWith(ENTRIES);
    const onSelectionChange = vi.fn();
    render(
      <TraceViewer
        store={store}
        defaultSelection={{ entryId: "a" }}
        onSelectionChange={onSelectionChange}
      />,
    );
    act(() => store.clear());
    expect(onSelectionChange.mock.calls).toEqual([[{ entryId: null }, undefined]]);
    expect(onSelectionChange.mock.calls[0]).toHaveLength(2);
  });
});

describe("stable slots and callbacks", () => {
  function Counter(props: { label: string }): ReactElement {
    const [count, setCount] = useState(0);
    return (
      <button type="button" onClick={() => setCount(count + 1)}>
        {`${props.label} ${count}`}
      </button>
    );
  }

  /** A parent passing fresh slot arrays and callbacks on every render. */
  function Host(props: { prepend: boolean; onSelectionChange: () => void }): ReactElement {
    const panels: DetailPanel[] = [
      ...(props.prepend ? [{ id: "new", title: "New", render: () => <p>new</p> }] : []),
      { id: "count", title: "Count", render: () => <Counter label="panel" /> },
    ];
    const controls: FilterControl[] = [
      { id: "count", label: "Count control", render: () => <Counter label="control" /> },
    ];
    return (
      <TraceViewer
        store={STABLE_STORE}
        detailPanels={panels}
        filterControls={controls}
        toolbarActions={[{ id: "noop", label: "Noop", run: () => {} }]}
        defaultSelection={{ entryId: "a" }}
        onSelectionChange={props.onSelectionChange}
      />
    );
  }
  const STABLE_STORE = storeWith(ENTRIES);

  it("keeps the state of host slots across parent renders with fresh arrays", () => {
    const first = vi.fn();
    const { rerender } = render(<Host prepend={false} onSelectionChange={first} />);
    fireEvent.click(screen.getByRole("button", { name: "panel 0" }));
    fireEvent.click(screen.getByRole("button", { name: "control 0" }));
    const second = vi.fn();
    rerender(<Host prepend onSelectionChange={second} />);
    expect(panel("New")).not.toBeNull();
    expect(screen.getByRole("button", { name: "panel 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "control 1" })).toBeDefined();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("calls the latest onSelectionChange from a select captured earlier", () => {
    const store = storeWith(ENTRIES);
    function Capturing(props: { context: DetailPanelContext }): ReactElement {
      const [select] = useState(() => (id: string) => props.context.select(id));
      return (
        <button type="button" onClick={() => select("c")}>
          Captured
        </button>
      );
    }
    const capturing: DetailPanel = {
      id: "capturing",
      title: "Capturing",
      render: (context) => <Capturing context={context} />,
    };
    const first = vi.fn();
    const second = vi.fn();
    const view = (onSelectionChange: () => void) => (
      <TraceViewer
        store={store}
        detailPanels={[capturing]}
        defaultSelection={{ entryId: "a" }}
        onSelectionChange={onSelectionChange}
      />
    );
    const { rerender } = render(view(first));
    rerender(view(second));
    fireEvent.click(screen.getByRole("button", { name: "Captured" }));
    expect(first).not.toHaveBeenCalled();
    expect(second.mock.calls).toEqual([[{ entryId: "c" }, store.get("c")]]);
    expect(row("c").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the first slot of a duplicate id and warns once per id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const view = () => (
        <TraceViewer
          store={storeWith(ENTRIES)}
          defaultSelection={{ entryId: "a" }}
          toolbarActions={[
            { id: "dup", label: "First action", run: () => {} },
            { id: "dup", label: "Second action", run: () => {} },
          ]}
          filterControls={[
            { id: "dup", label: "First control", render: () => null },
            { id: "dup", label: "Second control", render: () => null },
          ]}
          detailPanels={[
            { id: "dup", title: "First panel", render: () => null },
            { id: "dup", title: "Second panel", render: () => null },
          ]}
        />
      );
      const { rerender } = render(view());
      rerender(view());
      expect(screen.getByRole("button", { name: "First action" })).toBeDefined();
      expect(screen.queryByRole("button", { name: "Second action" })).toBeNull();
      expect(screen.getByRole("group", { name: "First control" })).toBeDefined();
      expect(screen.queryByRole("group", { name: "Second control" })).toBeNull();
      expect(panel("First panel")).not.toBeNull();
      expect(panel("Second panel")).toBeNull();
      expect(warn).toHaveBeenCalledTimes(3);
      for (const kind of ["toolbar action", "filter control", "detail panel"]) {
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`${kind} id "dup"`));
      }
    } finally {
      warn.mockRestore();
    }
  });
});

describe("host columns", () => {
  it("renders a custom metadata column", () => {
    const entries = ENTRIES.map((entry, index): ViewerEntry => ({
      ...entry,
      metadata: { custom: { site: `S${index}` } },
    }));
    const site = {
      id: "site",
      label: "Site",
      value: (entry: ViewerEntry) => {
        const value = entry.metadata?.custom?.["site"];
        return typeof value === "string" ? value : undefined;
      },
    };
    render(<TraceViewer store={storeWith(entries)} columns={[site]} />);
    const headers = within(screen.getByRole("grid"))
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers.at(-1)).toBe("Site");
    const cells = within(row("b")).getAllByRole("gridcell");
    expect(cells.at(-1)?.textContent).toBe("S1");
  });
});

describe("stable filter control context", () => {
  it("calls the latest onFilterChange from a setFilter captured earlier", () => {
    function Capturing(props: { context: FilterControlContext }): ReactElement {
      const [setFilter] = useState(() => (next: TraceFilter) => props.context.setFilter(next));
      return (
        <button
          type="button"
          onClick={() => setFilter({ fields: [{ id: "zone", values: ["north"] }] })}
        >
          North
        </button>
      );
    }
    const control: FilterControl = {
      id: "capturing",
      label: "Capturing",
      render: (context) => <Capturing context={context} />,
    };
    const store = storeWith(ZONED);
    const first = vi.fn();
    const second = vi.fn();
    const view = (onFilterChange: (filter: TraceFilter) => void) => (
      <TraceViewer
        store={store}
        fields={ZONE_FIELDS}
        filterControls={[control]}
        onFilterChange={onFilterChange}
      />
    );
    const { rerender } = render(view(first));
    rerender(view(second));
    fireEvent.click(screen.getByRole("button", { name: "North" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith({
      fields: [{ id: "zone", values: ["north"] }],
    });
    expect(listedIds()).toEqual(["n1", "n2"]);
  });
});
