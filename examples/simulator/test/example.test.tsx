import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SimulatorExample } from "../src/SimulatorExample.tsx";
import { stubLayout } from "./layout.ts";

stubLayout();

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

function grid(): HTMLElement {
  return screen.getByRole("grid");
}

function rowTexts(): string[] {
  return within(grid())
    .getAllByRole("row")
    .filter((row) => row.dataset["entryId"] !== undefined)
    .map((row) => row.textContent ?? "");
}

async function renderLoaded(props: Parameters<typeof SimulatorExample>[0] = {}) {
  const result = render(<SimulatorExample {...props} />);
  await screen.findByText(/60 records read/);
  await screen.findByRole("grid");
  return result;
}

describe("<SimulatorExample>", () => {
  it("lists the captured traffic of CP001 and CP002", async () => {
    await renderLoaded();
    const texts = rowTexts();
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.some((text) => text.includes("CP001"))).toBe(true);
    expect(texts.some((text) => text.includes("CP002"))).toBe(true);
  });

  it("shows the 100 non-wire log lines in a host panel, not in the trace", async () => {
    await renderLoaded();
    const panel = screen.getByRole("region", { name: "Simulator log" });
    expect(within(panel).getByText(/100 lines/)).toBeTruthy();
    expect(within(panel).getAllByRole("listitem")).toHaveLength(100);
  });

  it("reflects the controlled filter and selection in the URL hash", async () => {
    await renderLoaded();
    const group = screen.getByRole("group", { name: "Charge points" });
    fireEvent.click(within(group).getByRole("checkbox", { name: /CP002/ }));
    expect(window.location.hash).toBe("#cp=CP002");
    expect(rowTexts().every((text) => text.includes("CP002"))).toBe(true);
  });

  it("restores the selection from the hash and shows meta.validation in a detail panel", async () => {
    window.history.replaceState(null, "", "/#sel=sim-25");
    await renderLoaded();
    const panel = screen.getByRole("region", { name: "Inbound validation" });
    expect(within(panel).getByText("TypeConstraintViolation")).toBeTruthy();
    expect(within(panel).getByText("warn")).toBeTruthy();
  });

  it("selects the record carrying meta.validation from a toolbar action", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Next validation warning" }));
    expect(window.location.hash).toBe("#sel=sim-25");
    expect(screen.getByRole("region", { name: "Inbound validation" })).toBeTruthy();
  });

  it("hands JSONL exports to the host", async () => {
    const download = vi.fn();
    await renderLoaded({ download });
    fireEvent.click(screen.getByRole("button", { name: "Export filtered" }));
    expect(download).toHaveBeenCalledTimes(1);
    const [name, text] = download.mock.calls[0] as [string, string];
    expect(name).toBe("simulator-filtered.jsonl");
    expect(text.trim().split("\n")).toHaveLength(60);
  });

  it("translates the viewer and the page to French", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Français" }));
    expect(screen.getByRole("group", { name: "Bornes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Suivre le plus récent" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Journal du simulateur" })).toBeTruthy();
  });

  it("replays the capture live, one record per tick", async () => {
    vi.useFakeTimers();
    try {
      render(<SimulatorExample replayIntervalMs={100} />);
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      fireEvent.click(screen.getByRole("button", { name: "Live replay" }));
      expect(screen.getByText("No entries")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Play replay" }));
      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(rowTexts()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
