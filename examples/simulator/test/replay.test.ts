import { createViewerStore } from "@open-ocpp-trace/viewer-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createLiveAdapter } from "../src/adapter/live-adapter.ts";
import { createReplay } from "../src/adapter/replay.ts";
import { readSimulatorTrace } from "../src/adapter/trace-reader.ts";
import { SIMULATOR_TRACE } from "./capture.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
  const store = createViewerStore();
  const live = createLiveAdapter();
  store.connect(live.adapter);
  const onChange = vi.fn();
  const replay = createReplay({ entries, push: live.push, intervalMs: 100, onChange });
  return { entries, store, replay, onChange };
}

describe("createReplay", () => {
  it("pushes one captured entry per tick, in timestamp order, while playing", async () => {
    const { entries, store, replay } = await setup();
    expect(store.size).toBe(0);

    replay.play();
    vi.advanceTimersByTime(300);
    expect(store.toArray().map((entry) => entry.id)).toEqual(["sim-1", "sim-2", "sim-3"]);
    expect(store.get("sim-1")).toEqual(entries[0]);

    replay.pause();
    vi.advanceTimersByTime(1000);
    expect(store.size).toBe(3);
    expect(replay.position).toBe(3);
  });

  it("stops by itself after the last entry", async () => {
    const { store, replay, onChange } = await setup();
    replay.play();
    vi.advanceTimersByTime(100 * 70);
    expect(store.size).toBe(60);
    expect(replay.playing).toBe(false);
    expect(replay.done).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith();
  });

  it("sorts entries by record timestamp, keeping the order of equal ones", async () => {
    const { entries } = await readSimulatorTrace(SIMULATOR_TRACE);
    const store = createViewerStore();
    const live = createLiveAdapter();
    store.connect(live.adapter);
    const replay = createReplay({
      entries: [...entries].reverse(),
      push: live.push,
      intervalMs: 1,
    });
    replay.play();
    vi.advanceTimersByTime(60);
    const times = store
      .toArray()
      .map((entry) => (entry.kind === "trace" ? Date.parse(entry.record.timestamp) : 0));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
