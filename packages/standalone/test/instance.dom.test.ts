import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ColumnDefinition } from "@open-ocpp-trace/viewer-core";
import { mount, type MountOptions } from "@open-ocpp-trace/viewer-standalone";

import {
  add,
  host,
  listedIds,
  rowOf,
  sdkEntry,
  shadowOf,
  stubLayout,
  stylesOf,
  track,
} from "./helpers.ts";

stubLayout();

afterEach(() => {
  vi.unstubAllGlobals();
});

function button(element: Element, text: string): HTMLButtonElement {
  const found = Array.from(shadowOf(element).querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

function viewerRoot(element: Element): HTMLElement {
  const root = shadowOf(element).querySelector<HTMLElement>(".oot-viewer");
  if (root === null) throw new Error("no viewer root");
  return root;
}

const TENANT: ColumnDefinition = {
  id: "tenant",
  label: "Tenant",
  value: (entry) => entry.metadata?.tenant,
};

describe("a mounted viewer", () => {
  it("lists the initial snapshot, then ingested and added entries", () => {
    const element = host();
    const instance = track(mount(element, { entries: [sdkEntry("a")] }));
    expect(listedIds(element)).toEqual(["a"]);

    instance.ingest([sdkEntry("a"), sdkEntry("b")]);
    expect(listedIds(element)).toEqual(["a", "b"]);

    instance.update([add(sdkEntry("c"))]);
    expect(listedIds(element)).toEqual(["a", "b", "c"]);
  });

  it("shows an entry update", () => {
    const element = host();
    const instance = track(mount(element, { entries: [sdkEntry("a")], columns: [TENANT] }));

    instance.update([{ type: "update", id: "a", metadata: { tenant: "acme" } }]);

    expect(rowOf(element, "a").textContent).toContain("acme");
  });

  it("calls onSelectionChange with the entry the user selects", async () => {
    const element = host();
    const onSelectionChange = vi.fn();
    track(mount(element, { entries: [sdkEntry("a"), sdkEntry("b")], onSelectionChange }));

    rowOf(element, "b").click();

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange.mock.calls[0]?.[0]).toEqual({ entryId: "b" });
    expect(onSelectionChange.mock.calls[0]?.[1]).toMatchObject({ id: "b" });
    // React renders a user event's update in a microtask, not during it.
    await vi.waitFor(() => {
      expect(rowOf(element, "b").getAttribute("aria-selected")).toBe("true");
    });
  });

  it("calls onFilterChange and onExport, as <TraceViewer> does", () => {
    const element = host();
    const onFilterChange = vi.fn();
    const onExport = vi.fn();
    track(mount(element, { entries: [sdkEntry("a")], onFilterChange, onExport }));

    shadowOf(element).querySelector<HTMLButtonElement>(".oot-filter-reset")?.click();
    button(element, "Export filtered").click();

    expect(onFilterChange).toHaveBeenCalledWith({});
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport.mock.calls[0]?.[0]).toMatchObject({ recordCount: 1 });
    expect(onExport.mock.calls[0]?.[1]).toBe("filtered");
  });

  it("passes strings, translate and toolbar actions through", () => {
    const element = host();
    const run = vi.fn();
    track(
      mount(element, {
        entries: [sdkEntry("a")],
        strings: { toolbar: { pause: "Pausa" } },
        translate: (key) => (key === "toolbar.follow" ? "Seguir" : undefined),
        toolbarActions: [{ id: "mark", label: "Mark", run }],
      }),
    );

    expect(button(element, "Pausa")).toBeDefined();
    expect(button(element, "Seguir")).toBeDefined();
    button(element, "Mark").click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("applies live options, and resets a key set to undefined", () => {
    const element = host();
    const instance = track(mount(element, { theme: { tokens: { background: "red" } } }));
    expect(viewerRoot(element).style.getPropertyValue("--oot-background")).toBe("red");

    instance.setOptions({ loading: true });
    expect(viewerRoot(element).style.getPropertyValue("--oot-background")).toBe("red");
    expect(shadowOf(element).textContent).toContain("Loading entries");

    instance.setOptions({ theme: undefined, loading: undefined });
    expect(viewerRoot(element).style.getPropertyValue("--oot-background")).toBe("");
    expect(shadowOf(element).textContent).not.toContain("Loading entries");
  });

  it("calls the latest callback given to setOptions", () => {
    const element = host();
    const first = vi.fn();
    const second = vi.fn();
    const instance = track(mount(element, { entries: [sdkEntry("a")], onSelectionChange: first }));

    instance.setOptions({ onSelectionChange: second });
    rowOf(element, "a").click();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each(["maxEntries", "maxBytes", "correlation", "adapter", "entries", "nonce"])(
    "rejects the mount-only option %s in setOptions",
    (key) => {
      const instance = track(mount(host()));

      expect(() => instance.setOptions({ [key]: undefined } as MountOptions)).toThrow(TypeError);
      expect(() => instance.setOptions({ [key]: undefined } as MountOptions)).toThrow(key);
    },
  );

  it.each([
    "store",
    "correlator",
    "renderPayload",
    "filterControls",
    "detailPanels",
    "className",
    "bogus",
  ])("rejects the unknown option %s in setOptions and keeps the live ones", (key) => {
    const element = host();
    const instance = track(mount(element, { loading: true }));
    const changes = { loading: false, [key]: undefined } as unknown as MountOptions;

    expect(() => instance.setOptions(changes)).toThrow(TypeError);
    expect(() => instance.setOptions(changes)).toThrow(`"${key}"`);
    instance.ingest([]);
    expect(shadowOf(element).textContent).toContain("Loading entries");
  });

  it("reports a throwing onSelectionChange and keeps working", async () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const failure = new Error("host failure");
    const element = host();
    const instance = track(
      mount(element, {
        maxEntries: 2,
        entries: [sdkEntry("a"), sdkEntry("b")],
        defaultSelection: { entryId: "a" },
        onSelectionChange: () => {
          throw failure;
        },
      }),
    );

    // Evicting the selected entry announces an empty selection.
    instance.update([add(sdkEntry("c"))]);
    await vi.waitFor(() => {
      expect(report).toHaveBeenCalledWith(failure);
    });
    instance.ingest([sdkEntry("d")]);

    expect(listedIds(element)).toEqual(["c", "d"]);
  });

  it("reports a throwing toolbar action and keeps working", () => {
    const report = vi.fn();
    vi.stubGlobal("reportError", report);
    const failure = new Error("action failure");
    const element = host();
    const instance = track(
      mount(element, {
        entries: [sdkEntry("a")],
        toolbarActions: [
          {
            id: "mark",
            label: "Mark",
            run: () => {
              throw failure;
            },
          },
        ],
      }),
    );

    button(element, "Mark").click();
    instance.ingest([sdkEntry("b")]);

    expect(report).toHaveBeenCalledExactlyOnceWith(failure);
    expect(listedIds(element)).toEqual(["a", "b"]);
    expect(button(element, "Mark")).toBeDefined();
  });

  it("passes maxEntries to the store", () => {
    const element = host();
    const instance = track(mount(element, { maxEntries: 1, entries: [sdkEntry("a")] }));

    instance.ingest([sdkEntry("b")]);

    expect(listedIds(element)).toEqual(["b"]);
  });

  it("passes maxBytes to the store", () => {
    const element = host();
    const instance = track(mount(element, { maxBytes: 1, entries: [sdkEntry("a")] }));

    instance.ingest([sdkEntry("b")]);

    expect(listedIds(element)).toEqual(["b"]);
  });

  it("throws from setOptions once unmounted", () => {
    const instance = mount(host());
    instance.unmount();

    expect(() => instance.setOptions({ loading: true })).toThrow(/unmounted/);
  });
});

describe("two viewers on one page", () => {
  it("keep their entries, selections, themes and stylesheets apart", async () => {
    const left = host();
    const right = host();
    const onLeft = vi.fn();
    const leftViewer = track(
      mount(left, {
        entries: [sdkEntry("a")],
        theme: { tokens: { background: "red" } },
        onSelectionChange: onLeft,
      }),
    );
    const rightViewer = track(mount(right, { entries: [sdkEntry("b")] }));

    leftViewer.ingest([sdkEntry("c")]);
    rowOf(right, "b").click();
    await vi.waitFor(() => {
      expect(rowOf(right, "b").getAttribute("aria-selected")).toBe("true");
    });

    expect(listedIds(left)).toEqual(["a", "c"]);
    expect(listedIds(right)).toEqual(["b"]);
    expect(onLeft).not.toHaveBeenCalled();
    expect(rowOf(left, "a").getAttribute("aria-selected")).not.toBe("true");
    expect(viewerRoot(left).style.getPropertyValue("--oot-background")).toBe("red");
    expect(viewerRoot(right).style.getPropertyValue("--oot-background")).toBe("");
    expect(shadowOf(left)).not.toBe(shadowOf(right));
    expect(stylesOf(left)).toContain(".oot-viewer");
    expect(stylesOf(right)).toContain(".oot-viewer");
    expect(rightViewer).not.toBe(leftViewer);
  });

  it("keep working when the other one is unmounted", () => {
    const left = host();
    const right = host();
    const leftViewer = mount(left, { entries: [sdkEntry("a")] });
    const rightViewer = track(mount(right, { entries: [sdkEntry("b")] }));

    leftViewer.unmount();
    rightViewer.ingest([sdkEntry("c")]);

    expect(left.childNodes).toHaveLength(0);
    expect(listedIds(right)).toEqual(["b", "c"]);
    expect(stylesOf(right)).toContain(".oot-viewer");
  });
});
