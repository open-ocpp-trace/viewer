import { describe, expect, it } from "vite-plus/test";

import { mount, type ViewerStoreStats } from "@open-ocpp-trace/viewer-standalone";

import { host, sdkEntry, shadowOf, stubLayout, track } from "./helpers.ts";

stubLayout();

function pause(element: Element): void {
  const button = Array.from(shadowOf(element).querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Pause",
  );
  if (button === undefined) throw new Error("no Pause button");
  button.click();
}

describe("ViewerInstance.getStats", () => {
  it("reports the store's bounds and ignored updates", () => {
    const element = host();
    const instance = track(mount(element, { maxEntries: 2, entries: [sdkEntry("a")] }));

    instance.ingest([sdkEntry("b"), sdkEntry("c")]);
    instance.update([{ type: "update", id: "gone", metadata: { tenant: "t" } }]);

    const stats: ViewerStoreStats = instance.getStats();
    expect(stats).toMatchObject({
      listed: 2,
      evicted: 1,
      unknownUpdates: 1,
      paused: false,
      pending: 0,
    });
  });

  it("counts what the user's pause holds and drops", () => {
    const element = host();
    const instance = track(mount(element, { maxEntries: 2 }));

    pause(element);
    instance.ingest([sdkEntry("a"), sdkEntry("b"), sdkEntry("c")]);

    // The pending budget keeps room for the gap resume() lists: one entry.
    expect(instance.getStats()).toMatchObject({ paused: true, pending: 1, droppedPending: 2 });
  });

  it("returns a snapshot that later changes do not alter", () => {
    const instance = track(mount(host(), { entries: [sdkEntry("a")] }));
    const before = instance.getStats();

    instance.ingest([sdkEntry("b")]);

    expect(before.listed).toBe(1);
    expect(instance.getStats().listed).toBe(2);
  });

  it("throws once unmounted", () => {
    const instance = mount(host());
    instance.unmount();

    expect(() => instance.getStats()).toThrow(/unmounted/);
  });
});
