import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createViewerStore,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { TraceViewer, type ExportScope, type JsonlExport } from "@open-ocpp-trace/viewer-react";

import { sdkEntry } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

function storeWith(entries: ViewerEntry[]): ViewerStore {
  const store = createViewerStore();
  store.load(entries);
  return store;
}

const ENTRIES: ViewerEntry[] = [
  sdkEntry("a"),
  sdkEntry("b", { chargePointId: "CP-2" }),
  { kind: "gap", id: "g", reason: "disconnected" },
  sdkEntry("c", { action: "Authorize" }),
];

function messageIds(exported: JsonlExport): string[] {
  return exported.text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line).messageId);
}

function lastExport(onExport: ReturnType<typeof vi.fn>): [JsonlExport, ExportScope] {
  expect(onExport).toHaveBeenCalledTimes(1);
  return onExport.mock.calls[0] as [JsonlExport, ExportScope];
}

describe("<TraceViewer> export actions", () => {
  it("renders no export button without onExport", () => {
    render(<TraceViewer store={storeWith(ENTRIES)} defaultSelection={{ entryId: "a" }} />);

    expect(screen.queryByRole("button", { name: "Export selection" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export filtered" })).toBeNull();
  });

  it("disables the selection export while nothing is selected", () => {
    render(<TraceViewer store={storeWith(ENTRIES)} onExport={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Export selection" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Export filtered" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("exports the selected trace entry", () => {
    const onExport = vi.fn();
    render(
      <TraceViewer
        store={storeWith(ENTRIES)}
        defaultSelection={{ entryId: "b" }}
        onExport={onExport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export selection" }));

    const [exported, scope] = lastExport(onExport);
    expect(scope).toBe("selection");
    expect(messageIds(exported)).toEqual(["m-b"]);
    const status = screen.getByText("Exported 1 record");
    expect(status.closest('[role="status"]')).not.toBeNull();
  });

  it("exports a selected gap as no record and one skipped entry", () => {
    const onExport = vi.fn();
    render(
      <TraceViewer
        store={storeWith(ENTRIES)}
        defaultSelection={{ entryId: "g" }}
        onExport={onExport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Export selection" }));

    const [exported, scope] = lastExport(onExport);
    expect(scope).toBe("selection");
    expect(exported.recordCount).toBe(0);
    expect(exported.skipped).toEqual({ unparsed: 0, gap: 1, invalid: 0 });
    expect(screen.getByText("Exported 0 records (1 skipped)")).toBeTruthy();
  });

  it("exports the listed entries in order under the active filter", () => {
    const onExport = vi.fn();
    const store = storeWith([...ENTRIES, sdkEntry("d", { chargePointId: "CP-2" })]);
    render(<TraceViewer store={store} filter={{ chargePointIds: ["CP-2"] }} onExport={onExport} />);

    fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));

    const [exported, scope] = lastExport(onExport);
    expect(scope).toBe("filtered");
    expect(messageIds(exported)).toEqual(["m-b", "m-d"]);
    // The engine tests a gap on `kinds` only: it stays listed, and skipped.
    expect(exported.skipped).toEqual({ unparsed: 0, gap: 1, invalid: 0 });
    expect(screen.getByText("Exported 2 records (1 skipped)")).toBeTruthy();
  });

  it("counts the listed gaps of an unfiltered export as skipped", () => {
    const onExport = vi.fn();
    render(<TraceViewer store={storeWith(ENTRIES)} onExport={onExport} />);

    fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));

    const [exported] = lastExport(onExport);
    expect(messageIds(exported)).toEqual(["m-a", "m-b", "m-c"]);
    expect(screen.getByText("Exported 3 records (1 skipped)")).toBeTruthy();
  });
});

describe("<TraceViewer redactExport>", () => {
  const SECRET: ViewerEntry[] = [
    sdkEntry("s", { action: "Authorize", payload: { idTag: "SECRET-1", token: "SECRET-2" } }),
  ];

  function exportBoth(props: Partial<Parameters<typeof TraceViewer>[0]>): JsonlExport[] {
    const onExport = vi.fn();
    render(
      <TraceViewer
        store={storeWith(SECRET)}
        defaultSelection={{ entryId: "s" }}
        onExport={onExport}
        {...props}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Export selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));
    expect(onExport).toHaveBeenCalledTimes(2);
    return onExport.mock.calls.map((call) => call[0] as JsonlExport);
  }

  it("exports records unmodified by default, even when the panel redacts", () => {
    for (const exported of exportBoth({})) {
      expect(exported.text).toContain("SECRET-1");
      expect(exported.text).not.toContain("redaction");
    }
  });

  it("redacts both exports with the default sensitive keys", () => {
    for (const exported of exportBoth({ redactExport: true })) {
      expect(exported.text).not.toContain("SECRET-1");
      expect(exported.text).toContain("SECRET-2");
      expect(JSON.parse(exported.text).meta.redaction).toEqual({
        by: "@open-ocpp-trace/viewer-react",
        rawDropped: false,
      });
    }
  });

  it("redacts with the sensitiveKeys prop, whatever revealSensitive says", () => {
    const props = { redactExport: true, sensitiveKeys: ["token"], revealSensitive: true };
    for (const exported of exportBoth(props)) {
      expect(exported.text).toContain("SECRET-1");
      expect(exported.text).not.toContain("SECRET-2");
    }
  });
});
