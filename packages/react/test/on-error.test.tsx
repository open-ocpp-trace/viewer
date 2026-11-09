import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type CorrelationChange,
  type Correlator,
  type FilterEngine,
  type ViewerEntry,
  type ViewerErrorHandler,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import {
  type DetailPanel,
  EntryInspector,
  FilterPanel,
  type ToolbarAction,
  TraceList,
  TraceViewer,
  useFilterEngine,
} from "@open-ocpp-trace/viewer-react";

import { add, sdkEntry } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function storeWith(entries: ViewerEntry[], maxEntries?: number): ViewerStore {
  const store = createViewerStore(maxEntries === undefined ? {} : { maxEntries });
  store.load(entries);
  return store;
}

function row(id: string): HTMLElement {
  const found = within(screen.getByRole("grid"))
    .getAllByRole("row")
    .find((candidate) => candidate.dataset["entryId"] === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

const ENTRIES = [sdkEntry("a"), sdkEntry("b"), sdkEntry("c")];

/** A translate failing for the pause button only. */
function failingTranslate(failure: Error): (key: string) => string | undefined {
  return (key) => {
    if (key === "toolbar.pause" || key === "listLabel") throw failure;
    return undefined;
  };
}

const viewer = (callback: string) => ({ component: "TraceViewer", callback });

describe("<TraceViewer> onError", () => {
  it("reports to globalThis.reportError by default", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("translate");
    render(<TraceViewer store={storeWith(ENTRIES)} translate={failingTranslate(failure)} />);
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(reportError).toHaveBeenCalledWith(failure);
  });

  it("reports to console.error without reportError", () => {
    vi.stubGlobal("reportError", undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("translate");
    render(<TraceViewer store={storeWith(ENTRIES)} translate={failingTranslate(failure)} />);
    expect(log).toHaveBeenCalledWith(failure);
  });

  it("passes each host callback error to onError with its context", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const onError = vi.fn<ViewerErrorHandler>();
    const translateFailure = new Error("translate");
    const runFailure = new Error("run");
    const disabledFailure = new Error("disabled");
    const appliesFailure = new Error("appliesTo");
    const selectionFailure = new Error("onSelectionChange");
    const actions: ToolbarAction[] = [
      {
        id: "run",
        label: "Run",
        run: () => {
          throw runFailure;
        },
      },
      {
        id: "disabled",
        label: "Disabled",
        disabled: () => {
          throw disabledFailure;
        },
        run: () => {},
      },
    ];
    const panel: DetailPanel = {
      id: "panel",
      title: "Panel",
      appliesTo: () => {
        throw appliesFailure;
      },
      render: () => <p>never</p>,
    };
    const store = storeWith(ENTRIES.slice(0, 2), 2);
    render(
      <TraceViewer
        store={store}
        defaultSelection={{ entryId: "a" }}
        onSelectionChange={(selection) => {
          if (selection.entryId === null) throw selectionFailure;
        }}
        translate={failingTranslate(translateFailure)}
        toolbarActions={actions}
        detailPanels={[panel]}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    act(() => store.apply([add(sdkEntry("c"))]));

    expect(onError).toHaveBeenCalledWith(translateFailure, viewer("translate"));
    expect(onError).toHaveBeenCalledWith(disabledFailure, viewer("toolbarActions.disabled"));
    expect(onError).toHaveBeenCalledWith(appliesFailure, viewer("detailPanels.appliesTo"));
    expect(onError).toHaveBeenCalledWith(runFailure, viewer("toolbarActions.run"));
    expect(onError).toHaveBeenCalledWith(selectionFailure, viewer("onSelectionChange"));
    expect(reportError).not.toHaveBeenCalled();
    // The viewer keeps working.
    fireEvent.click(row("b"));
    expect(row("b").getAttribute("aria-selected")).toBe("true");
  });

  it("reports both errors to the default once each when onError throws", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const handlerError = new Error("handler");
    const onError = vi.fn<ViewerErrorHandler>(() => {
      throw handlerError;
    });
    const runFailure = new Error("run");
    const action: ToolbarAction = {
      id: "run",
      label: "Run",
      run: () => {
        throw runFailure;
      },
    };
    const onSelectionChange = vi.fn();
    render(
      <TraceViewer
        store={storeWith(ENTRIES)}
        toolbarActions={[action]}
        onSelectionChange={onSelectionChange}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(onError).toHaveBeenCalledExactlyOnceWith(runFailure, viewer("toolbarActions.run"));
    expect(reportError.mock.calls).toEqual([[runFailure], [handlerError]]);
    // Other callbacks are still delivered.
    fireEvent.click(row("b"));
    expect(onSelectionChange).toHaveBeenCalledWith({ entryId: "b" }, expect.anything());
  });

  it("forwards onError to its filter engine", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const correlator = createCorrelator();
    const listeners = new Set<(change: CorrelationChange) => void>();
    const capturing: Correlator = {
      ...correlator,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    render(<TraceViewer store={storeWith(ENTRIES)} correlator={capturing} onError={onError} />);
    const failure = new Error("cleared");
    const hostile = {
      get cleared(): boolean {
        throw failure;
      },
    } as unknown as CorrelationChange;
    act(() => {
      for (const listener of listeners) listener(hostile);
    });
    expect(onError).toHaveBeenCalledWith(failure, {
      component: "filterEngine",
      callback: "correlate",
    });
  });

  it("reports to the latest onError", () => {
    const first = vi.fn<ViewerErrorHandler>();
    const second = vi.fn<ViewerErrorHandler>();
    const failure = new Error("run");
    const action: ToolbarAction = {
      id: "run",
      label: "Run",
      run: () => {
        throw failure;
      },
    };
    const store = storeWith(ENTRIES);
    const { rerender } = render(
      <TraceViewer store={store} toolbarActions={[action]} onError={first} />,
    );
    rerender(<TraceViewer store={store} toolbarActions={[action]} onError={second} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(failure, viewer("toolbarActions.run"));
  });
});

describe("useFilterEngine onError", () => {
  /** A store whose `get` throws once `fail` is called. */
  function flakyStore(): { store: ViewerStore; source: ViewerStore; fail: () => void } {
    const source = storeWith(ENTRIES);
    let failing = false;
    return {
      store: {
        ...source,
        get: (id) => {
          if (failing) throw new Error("get");
          return source.get(id);
        },
      },
      source,
      fail: () => {
        failing = true;
      },
    };
  }

  it("keeps the engine across inline handlers and reports to the latest one", () => {
    const engines = new Set<FilterEngine>();
    function Probe(props: { store: ViewerStore; onError: ViewerErrorHandler }): ReactElement {
      // An inline handler: a new identity on every render.
      const engine = useFilterEngine(props.store, {
        onError: (error, context) => props.onError(error, context),
      });
      engines.add(engine);
      return <p>{engine.size}</p>;
    }
    const { store, source, fail } = flakyStore();
    const first = vi.fn<ViewerErrorHandler>();
    const second = vi.fn<ViewerErrorHandler>();
    const { rerender } = render(<Probe store={store} onError={first} />);
    rerender(<Probe store={store} onError={second} />);
    expect(engines.size).toBe(1);
    fail();
    act(() => source.apply([add(sdkEntry("d"))]));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(new Error("get"), {
      component: "filterEngine",
      callback: "follow",
    });
  });
});

describe("standalone components onError", () => {
  function Panel(props: { store: ViewerStore; onError: ViewerErrorHandler }): ReactElement {
    const engine = useFilterEngine(props.store);
    return (
      <FilterPanel
        engine={engine}
        translate={(key) => {
          if (key === "filter.panelLabel") throw new Error(key);
          return undefined;
        }}
        onError={props.onError}
      />
    );
  }

  function List(props: { store: ViewerStore; onError: ViewerErrorHandler }): ReactElement {
    const engine = useFilterEngine(props.store);
    return (
      <TraceList
        engine={engine}
        selectedId={null}
        onSelectedIdChange={() => {}}
        translate={(key) => {
          if (key === "listLabel") throw new Error(key);
          return undefined;
        }}
        onError={props.onError}
      />
    );
  }

  it("reports a throwing translate of <FilterPanel> to its onError", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    render(<Panel store={storeWith(ENTRIES)} onError={onError} />);
    expect(onError).toHaveBeenCalledWith(new Error("filter.panelLabel"), {
      component: "FilterPanel",
      callback: "translate",
    });
  });

  it("reports a throwing translate of <TraceList> to its onError", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    render(<List store={storeWith(ENTRIES)} onError={onError} />);
    expect(onError).toHaveBeenCalledWith(new Error("listLabel"), {
      component: "TraceList",
      callback: "translate",
    });
    expect(row("a")).toBeDefined();
  });

  it("reports a throwing translate of <EntryInspector> to its onError", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    render(
      <EntryInspector
        store={storeWith(ENTRIES)}
        entryId={null}
        translate={(key) => {
          if (key === "inspector.empty") throw new Error(key);
          return undefined;
        }}
        onError={onError}
      />,
    );
    expect(onError).toHaveBeenCalledWith(new Error("inspector.empty"), {
      component: "EntryInspector",
      callback: "translate",
    });
  });

  it("reports a <FilterPanel> translate error by default without onError", () => {
    vi.stubGlobal("reportError", undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const engineStore = storeWith(ENTRIES);
    function Bare(): ReactElement {
      const engine = useFilterEngine(engineStore);
      return (
        <FilterPanel
          engine={engine}
          translate={(key) => {
            if (key === "filter.panelLabel") throw new Error(key);
            return undefined;
          }}
        />
      );
    }
    render(<Bare />);
    expect(log).toHaveBeenCalledWith(new Error("filter.panelLabel"));
  });
});
