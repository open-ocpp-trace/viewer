import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createViewerStore, type ViewerStore } from "@open-ocpp-trace/viewer-core";
import {
  defaultStrings,
  EntryInspector,
  FilterPanel,
  TraceList,
  TraceViewer,
  type PartialViewerStrings,
  type TranslateFunction,
  useFilterEngine,
} from "@open-ocpp-trace/viewer-react";

import { resolveStrings } from "../src/strings-context.ts";
import { stringParams } from "../src/strings.ts";
import { add, sdkEntry } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every leaf of `node` as [dotted key, value]. */
function leaves(node: object, prefix = ""): [string, unknown][] {
  return Object.entries(node).flatMap(([name, value]): [string, unknown][] =>
    typeof value === "object" && value !== null
      ? leaves(value as object, `${prefix}${name}.`)
      : [[`${prefix}${name}`, value]],
  );
}

function storeWith(count: number): ViewerStore {
  const store = createViewerStore({});
  store.load(Array.from({ length: count }, (_, i) => sdkEntry(String(i))));
  return store;
}

describe("the named parameters of function strings", () => {
  it("name every parameter of every function leaf, and nothing else", () => {
    const functions = leaves(defaultStrings).filter(([, value]) => typeof value === "function");
    expect(functions.length).toBeGreaterThan(5);
    expect(Object.keys(stringParams).sort()).toEqual(functions.map(([key]) => key).sort());
    for (const [key, value] of functions) {
      expect(stringParams[key]?.length, key).toBe((value as (...args: never[]) => string).length);
    }
  });
});

describe("resolveStrings", () => {
  it("returns the defaults when nothing is given", () => {
    expect(resolveStrings(undefined, undefined)).toBe(defaultStrings);
  });

  it("prefers translate, then the overrides, then the defaults", () => {
    const translate: TranslateFunction = (key) => (key === "toolbar.pause" ? "T-pause" : undefined);
    const strings: PartialViewerStrings = {
      toolbar: { pause: "S-pause", follow: "S-follow" },
      inspector: { fields: { action: "S-action" } },
    };
    const resolved = resolveStrings(strings, translate);
    expect(resolved.toolbar.pause).toBe("T-pause");
    expect(resolved.toolbar.follow).toBe("S-follow");
    expect(resolved.inspector.fields.action).toBe("S-action");
    expect(resolved.inspector.fields.messageId).toBe(defaultStrings.inspector.fields.messageId);
    expect(resolved.filter.kindNames["gap"]).toBe("Gaps");
  });

  it("calls translate with the dotted key and named parameters", () => {
    const translate = vi.fn<TranslateFunction>((key, params) =>
      key === "toolbar.exported" ? `${params["count"]}/${params["skipped"]}` : undefined,
    );
    const resolved = resolveStrings(undefined, translate);
    expect(translate).toHaveBeenCalledWith("filter.kindNames.trace", {});
    expect(translate).toHaveBeenCalledWith("columns.action", {});
    expect(resolved.toolbar.exported(3, 1)).toBe("3/1");
    expect(resolved.gap(2, "lost")).toBe(defaultStrings.gap(2, "lost"));
    expect(translate).toHaveBeenLastCalledWith("gap", { missedCount: 2, reason: "lost" });
  });

  it("uses an override function when translate has no text", () => {
    const resolved = resolveStrings(
      { toolbar: { pending: (count) => `${count} en attente` } },
      () => undefined,
    );
    expect(resolved.toolbar.pending(4)).toBe("4 en attente");
    expect(
      resolveStrings({ toolbar: { pending: (n) => `${n}!` } }, undefined).toolbar.pending(2),
    ).toBe("2!");
  });

  it("reports a throwing translate and falls back", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const failure = new Error("translate failure");
    const resolved = resolveStrings({ toolbar: { follow: "Suivre" } }, (key) => {
      if (key === "toolbar.follow" || key === "toolbar.pending") throw failure;
      return undefined;
    });
    expect(resolved.toolbar.follow).toBe("Suivre");
    expect(resolved.toolbar.pending(1)).toBe(defaultStrings.toolbar.pending(1));
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith(failure);
  });
});

function Panel(props: { store: ViewerStore; strings?: PartialViewerStrings }) {
  const engine = useFilterEngine(props.store);
  return (
    <FilterPanel
      engine={engine}
      {...(props.strings !== undefined && { strings: props.strings })}
      filter={{ chargePointIds: ["CP-1"] }}
    />
  );
}

function List(props: { store: ViewerStore; translate: TranslateFunction }) {
  const engine = useFilterEngine(props.store);
  return <TraceList engine={engine} translate={props.translate} />;
}

describe("localized components", () => {
  const upper: TranslateFunction = (key) => `<${key}>`;

  it("localizes the composite viewer and its children through translate", () => {
    const store = storeWith(2);
    render(<TraceViewer store={store} translate={upper} onExport={() => {}} />);
    expect(screen.getByRole("button", { name: "<toolbar.pause>" })).toBeDefined();
    expect(screen.getByRole("grid", { name: "<listLabel>" })).toBeDefined();
    expect(screen.getByRole("columnheader", { name: "<columns.action>" })).toBeDefined();
    expect(screen.getByRole("group", { name: "<filter.panelLabel>" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "<filter.clearGroup>" }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole("region", { name: "<inspector.label>" }).textContent).toBe(
      "<inspector.empty>",
    );
  });

  it("formats the export status with the current strings", () => {
    const store = storeWith(2);
    const { rerender } = render(<TraceViewer store={store} onExport={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));
    expect(screen.getByRole("status").textContent).toBe("Exported 2 records");
    rerender(
      <TraceViewer
        store={store}
        onExport={() => {}}
        strings={{ toolbar: { exported: (count) => `${count} exportés` } }}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("2 exportés");
  });

  it("localizes a standalone list, panel and inspector through their own props", () => {
    const store = storeWith(1);
    render(<List store={store} translate={upper} />);
    expect(screen.getByRole("grid", { name: "<listLabel>" })).toBeDefined();
    render(<Panel store={store} strings={{ filter: { clear: "Effacer", none: "(aucun)" } }} />);
    const charge = screen.getByRole("group", { name: "Charge points" });
    expect(within(charge).getByRole("button", { name: "Clear Charge points" }).textContent).toBe(
      "Effacer",
    );
    render(
      <EntryInspector store={store} entryId={null} strings={{ inspector: { empty: "Rien" } }} />,
    );
    expect(screen.getByRole("region", { name: "Entry details" }).textContent).toBe("Rien");
  });

  it("resolves the strings once per strings and translate identity", () => {
    const store = storeWith(1);
    const translate = vi.fn<TranslateFunction>(() => undefined);
    const strings = { toolbar: { pause: "Pause !" } };
    const { rerender } = render(
      <TraceViewer store={store} translate={translate} strings={strings} />,
    );
    const calls = (): number =>
      translate.mock.calls.filter(([key]) => key === "toolbar.pause").length;
    const first = calls();
    expect(first).toBeGreaterThan(0);
    act(() => store.apply([add(sdkEntry("x"))]));
    rerender(<TraceViewer store={store} translate={translate} strings={strings} />);
    expect(calls()).toBe(first);
    rerender(<TraceViewer store={store} translate={translate} strings={{ ...strings }} />);
    expect(calls()).toBeGreaterThan(first);
    expect(screen.getByRole("button", { name: "Pause !" })).toBeDefined();
  });

  it("keeps the viewer mounted when translate throws", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    render(
      <TraceViewer
        store={storeWith(1)}
        translate={() => {
          throw new Error("broken catalog");
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(report).toHaveBeenCalled();
  });
});
