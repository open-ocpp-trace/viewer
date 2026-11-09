import { describe, expect, it } from "vite-plus/test";

import { createAnalysisScheduler, type TimerHost } from "../src/scheduler.ts";

/** A manual clock: timers fire only when the test advances time. */
function fakeTimers(): TimerHost & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    setTimeout(callback, ms) {
      nextId += 1;
      timers.set(nextId, { at: now + ms, callback });
      return nextId;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    },
    pending() {
      return timers.size;
    },
  };
}

describe("createAnalysisScheduler", () => {
  it("parses once for many changes within one window", () => {
    const timers = fakeTimers();
    let parses = 0;
    const scheduler = createAnalysisScheduler({ run: () => (parses += 1), windowMs: 1000, timers });

    for (let change = 0; change < 50; change += 1) {
      scheduler.markStale();
      timers.advance(10);
    }
    expect(parses).toBe(0);
    expect(scheduler.stale).toBe(true);

    timers.advance(1000);
    expect(parses).toBe(1);
    expect(scheduler.stale).toBe(false);
    timers.advance(10_000);
    expect(parses).toBe(1);
  });

  it("keeps parsing about once per window under a steady stream of changes", () => {
    const timers = fakeTimers();
    let parses = 0;
    const scheduler = createAnalysisScheduler({ run: () => (parses += 1), windowMs: 1000, timers });

    for (let change = 0; change < 50; change += 1) {
      scheduler.markStale();
      timers.advance(100);
    }

    expect(parses).toBeGreaterThanOrEqual(4);
    expect(parses).toBeLessThanOrEqual(5);
  });

  it("parses once more after a parse during which the store changed", () => {
    const timers = fakeTimers();
    let parses = 0;
    const scheduler = createAnalysisScheduler({
      run: () => {
        parses += 1;
        if (parses === 1) scheduler.markStale();
      },
      windowMs: 1000,
      timers,
    });

    scheduler.markStale();
    timers.advance(1000);
    expect(parses).toBe(1);
    expect(scheduler.stale).toBe(true);

    timers.advance(1000);
    expect(parses).toBe(2);
    timers.advance(10_000);
    expect(parses).toBe(2);
  });

  it("waits for an asynchronous parse before starting another one", async () => {
    const timers = fakeTimers();
    let parses = 0;
    let finish = (): void => {};
    const scheduler = createAnalysisScheduler({
      run: () => {
        parses += 1;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      windowMs: 1000,
      timers,
    });

    scheduler.markStale();
    timers.advance(1000);
    scheduler.markStale();
    scheduler.runNow();
    timers.advance(5000);
    expect(parses).toBe(1);
    expect(scheduler.running).toBe(true);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    timers.advance(1000);
    expect(parses).toBe(2);
  });

  it("parses at once on demand and drops the pending window", () => {
    const timers = fakeTimers();
    let parses = 0;
    const scheduler = createAnalysisScheduler({ run: () => (parses += 1), windowMs: 1000, timers });

    scheduler.markStale();
    scheduler.runNow();
    expect(parses).toBe(1);
    expect(timers.pending()).toBe(0);
    timers.advance(5000);
    expect(parses).toBe(1);
  });

  it("reports a throwing parse and keeps scheduling", () => {
    const timers = fakeTimers();
    const errors: unknown[] = [];
    let parses = 0;
    const scheduler = createAnalysisScheduler({
      run: () => {
        parses += 1;
        if (parses === 1) throw new Error("boom");
      },
      windowMs: 1000,
      timers,
      onError: (error) => errors.push(error),
    });

    scheduler.runNow();
    scheduler.markStale();
    timers.advance(1000);

    expect(errors).toEqual([new Error("boom")]);
    expect(parses).toBe(2);
  });

  it("does nothing once disposed", () => {
    const timers = fakeTimers();
    let parses = 0;
    const scheduler = createAnalysisScheduler({ run: () => (parses += 1), windowMs: 1000, timers });

    scheduler.markStale();
    scheduler.dispose();
    scheduler.markStale();
    scheduler.runNow();
    timers.advance(5000);

    expect(parses).toBe(0);
    expect(timers.pending()).toBe(0);
  });
});
