import { parseOpenOcppTrace, type ParseResult } from "@ocpp-debugkit/toolkit/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  createViewerStore,
  type EntryUpdate,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { describe, expect, it, vi } from "vite-plus/test";

import { analyzeSnapshot, type Analysis } from "../src/analysis.ts";
import { App } from "../src/App.tsx";
import { createExampleStore } from "../src/example-store.ts";
import { readFixtureEntries } from "../src/load-fixture.ts";
import { buildSnapshot } from "../src/snapshot.ts";
import { readEdgeCases, readSpecFixture } from "./fixtures.ts";
import { stubLayout } from "./layout.ts";

stubLayout();

/** A record arriving after the fixtures, as from a live source. */
const LIVE_HEARTBEAT: EntryUpdate = {
  type: "add",
  entry: {
    kind: "trace",
    id: "live:1",
    record: {
      schemaVersion: "1.1",
      timestamp: "2024-01-15T14:00:00.000Z",
      transport: "json",
      direction: "cp-to-csms",
      messageType: "CALL",
      messageId: "live-1",
      action: "Heartbeat",
      payload: {},
    },
  },
};

function row(id: string): HTMLElement {
  const found = within(screen.getByRole("grid"))
    .getAllByRole("row")
    .find((candidate) => candidate.dataset["entryId"] === id);
  if (found === undefined) throw new Error(`no row for ${id}`);
  return found;
}

function timelineItems(): HTMLElement[] {
  return within(screen.getByRole("region", { name: "DebugKit timeline" })).getAllByRole("listitem");
}

/** Indexes of the timeline items DebugKit highlights as selected. */
function highlighted(): number[] {
  return timelineItems().flatMap((item, index) =>
    item.style.backgroundColor === "" ? [] : [index],
  );
}

function detailPanel(): HTMLElement {
  return screen.getByRole("region", { name: "DebugKit" });
}

async function renderExample(): Promise<{ store: ViewerStore; analysis: Analysis }> {
  const store = await createExampleStore();
  // What the app computes on mount, recomputed here to locate events.
  const analysis = analyzeSnapshot(buildSnapshot(store.toArray()));
  render(<App store={store} />);
  await screen.findByText(`Timeline (${analysis.events.length} events)`);
  return { store, analysis };
}

function eventIndex(analysis: Analysis, entryId: string): number {
  const eventId = analysis.mapping.eventByEntry.get(entryId);
  return analysis.events.findIndex((event) => event.id === eventId);
}

describe("the DebugKit example", () => {
  it("shows the fixtures in the viewer and in DebugKit", async () => {
    const { store, analysis } = await renderExample();

    const listed = within(screen.getByRole("grid"))
      .getAllByRole("row")
      .filter((candidate) => candidate.dataset["entryId"] !== undefined);
    expect(listed).toHaveLength(store.size);
    expect(timelineItems()).toHaveLength(analysis.events.length);
    expect(screen.getByText(`Failures (${analysis.failures.length})`)).toBeDefined();
    expect(highlighted()).toEqual([]);
    const status = screen.getByRole("region", { name: "DebugKit analysis" });
    expect(within(status).getAllByRole("listitem")).toHaveLength(analysis.warnings.length);
  });

  it("flags the analysis as stale until the next refresh", async () => {
    const { store } = await renderExample();
    const status = (): string =>
      screen.getByRole("region", { name: "DebugKit analysis" }).textContent ?? "";
    expect(status()).not.toContain("changed since");

    act(() => {
      store.clear();
    });
    expect(status()).toContain("changed since");

    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));
    expect(status()).not.toContain("changed since");
  });

  it("selects the mapped event when a row is selected", async () => {
    const { analysis } = await renderExample();
    const index = eventIndex(analysis, "failed-auth:3");
    expect(index).toBeGreaterThanOrEqual(0);

    fireEvent.click(row("failed-auth:3"));

    expect(row("failed-auth:3").getAttribute("aria-selected")).toBe("true");
    expect(highlighted()).toEqual([index]);
    expect(within(detailPanel()).getByText(analysis.events[index]!.id)).toBeDefined();
  });

  it("selects the mapped row when a timeline event is selected", async () => {
    const { analysis } = await renderExample();
    const index = eventIndex(analysis, "edge:2");
    expect(index).toBeGreaterThanOrEqual(0);

    fireEvent.click(timelineItems()[index]!);

    expect(row("edge:2").getAttribute("aria-selected")).toBe("true");
    expect(highlighted()).toEqual([index]);
  });

  it.each([
    ["edge:1", "ignored"],
    ["edge:6", "ambiguous"],
  ])("selects nothing in DebugKit for %s, %s", async (entryId, reason) => {
    await renderExample();

    fireEvent.click(row(entryId));

    expect(highlighted()).toEqual([]);
    expect(within(detailPanel()).getByText(/not analyzed by DebugKit/i)).toBeDefined();
    expect(within(detailPanel()).getByText(new RegExp(reason))).toBeDefined();
  });

  it("explains that an unparsed entry was never sent", async () => {
    const { store } = await renderExample();
    const unparsed = store.toArray().find((entry) => entry.kind === "unparsed");
    expect(unparsed).toBeDefined();

    fireEvent.click(row(unparsed!.id));

    expect(highlighted()).toEqual([]);
    expect(within(detailPanel()).getByText(/unparsed/)).toBeDefined();
  });

  it("leaves the selection alone and says why for an event with no single entry", async () => {
    const { analysis } = await renderExample();
    const unmatched = analysis.mapping.unmatchedEventIds[0];
    const index = analysis.events.findIndex((event) => event.id === unmatched);
    expect(index).toBeGreaterThanOrEqual(0);
    fireEvent.click(row("failed-auth:3"));

    fireEvent.click(timelineItems()[index]!);

    expect(row("failed-auth:3").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("status", { name: "Timeline selection" }).textContent).toMatch(
      /no single viewer entry/,
    );
  });

  it("re-analyzes on « Analyze now » after the store changed", async () => {
    const { store, analysis } = await renderExample();

    act(() => {
      store.apply([LIVE_HEARTBEAT]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));

    // Synchronously: the bounded refresh would only run a window later.
    expect(screen.getByText(`Timeline (${analysis.events.length + 1} events)`)).toBeDefined();
  });

  it("drops the DebugKit selection and says why when the selected entry is evicted", async () => {
    // A store just big enough for the fixtures: the next add evicts the oldest entry.
    const capacity = (await createExampleStore()).size;
    const store = createViewerStore({ maxEntries: capacity });
    store.load(await readFixtureEntries("failed-auth", readSpecFixture()));
    store.load(await readFixtureEntries("edge", readEdgeCases()));
    const oldest = store.toArray()[0]!.id;
    const analysis = analyzeSnapshot(buildSnapshot(store.toArray()));
    expect(eventIndex(analysis, oldest)).toBeGreaterThanOrEqual(0);
    render(<App store={store} />);
    fireEvent.click(row(oldest));
    expect(highlighted()).toEqual([eventIndex(analysis, oldest)]);

    act(() => {
      store.apply([LIVE_HEARTBEAT]);
    });

    expect(store.get(oldest)).toBeUndefined();
    expect(highlighted()).toEqual([]);
    expect(screen.getByRole("status", { name: "Timeline selection" }).textContent).toMatch(
      /selected entry left the store/,
    );
  });

  it("does not map a re-added entry id to the previous record's event", async () => {
    const capacity = (await createExampleStore()).size;
    const store = createViewerStore({ maxEntries: capacity });
    store.load(await readFixtureEntries("failed-auth", readSpecFixture()));
    store.load(await readFixtureEntries("edge", readEdgeCases()));
    const oldest = store.toArray()[0]!.id;
    const analysis = analyzeSnapshot(buildSnapshot(store.toArray()));
    const index = eventIndex(analysis, oldest);
    expect(index).toBeGreaterThanOrEqual(0);
    render(<App store={store} />);

    // Evict the oldest entry, then add a new one under its id; no re-analysis yet.
    act(() => {
      store.apply([LIVE_HEARTBEAT]);
    });
    act(() => {
      store.apply([{ type: "add", entry: { ...LIVE_HEARTBEAT.entry, id: oldest } }]);
    });
    expect(store.get(oldest)).toBeDefined();

    fireEvent.click(row(oldest));
    expect(highlighted()).toEqual([]);
    expect(within(detailPanel()).getByText(/pending/)).toBeDefined();

    fireEvent.click(timelineItems()[index]!);
    expect(highlighted()).toEqual([]);
    expect(screen.getByRole("status", { name: "Timeline selection" }).textContent).toMatch(
      /no single viewer entry/,
    );
  });

  it("shows a failed analysis and keeps the previous one flagged as stale", async () => {
    const store = await createExampleStore();
    let failing = false;
    const parse = (input: string): ParseResult => {
      if (failing) throw new ReferenceError("Buffer is not defined");
      return parseOpenOcppTrace(input);
    };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<App store={store} parse={parse} />);
      const status = (): string =>
        screen.getByRole("region", { name: "DebugKit analysis" }).textContent ?? "";
      expect(status()).not.toContain("failed");

      act(() => {
        store.apply([LIVE_HEARTBEAT]);
      });
      failing = true;
      fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));

      expect(status()).toContain("changed since");
      expect(status()).toContain("The last analysis failed: Buffer is not defined");

      failing = false;
      fireEvent.click(screen.getByRole("button", { name: "Analyze now" }));

      expect(status()).not.toContain("changed since");
      expect(status()).not.toContain("failed");
    } finally {
      quiet.mockRestore();
    }
  });

  it("re-analyzes once the refresh window after a store change closes", async () => {
    const { store, analysis } = await renderExample();
    vi.useFakeTimers();
    try {
      act(() => {
        store.apply([LIVE_HEARTBEAT]);
      });
      expect(screen.getByText(`Timeline (${analysis.events.length} events)`)).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(screen.getByText(`Timeline (${analysis.events.length + 1} events)`)).toBeDefined();
      expect(screen.getByRole("region", { name: "DebugKit analysis" }).textContent).not.toContain(
        "changed since",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
