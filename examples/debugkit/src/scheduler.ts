/** The timer functions the scheduler uses; injected so tests drive time. */
export interface TimerHost {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AnalysisSchedulerOptions {
  /** One analysis: build the snapshot and parse it. May be asynchronous. */
  run(): unknown;
  /** Length of the window that bounds analyses to one each. Default 1,000 ms. */
  readonly windowMs?: number;
  readonly timers?: TimerHost;
  /** Receives what `run` throws or rejects with. Default `console.error`. */
  onError?(error: unknown): void;
}

export interface AnalysisScheduler {
  /** Records that the store changed; the analysis runs at the end of the window. */
  markStale(): void;
  /**
   * Runs an analysis now (« Analyze now »). During an analysis, it only
   * marks the analysis stale: one more runs a window after the current one.
   */
  runNow(): void;
  /** Stops scheduling; later calls do nothing. */
  dispose(): void;
  /** The store changed since the last analysis started. */
  readonly stale: boolean;
  readonly running: boolean;
}

const globalTimers: TimerHost = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Bounds how often the trace is analyzed while the store changes.
 *
 * DebugKit's `parseOpenOcppTrace` only accepts a whole document as a string,
 * so every analysis re-serializes the store's trace entries. Doing that on
 * each ingested record would cost O(n) per record, O(n²) for a live trace.
 * Instead a change only marks the analysis stale, and at most one analysis
 * runs per window: the first change opens a window, the analysis runs when it
 * closes (later changes in the window join it), so a steady stream of changes
 * still gets one analysis per window instead of none. A change during an
 * analysis opens a new window once it is done; analyses never overlap.
 */
export function createAnalysisScheduler(options: AnalysisSchedulerOptions): AnalysisScheduler {
  const windowMs = options.windowMs ?? 1000;
  const timers = options.timers ?? globalTimers;
  const report = (error: unknown): void => {
    if (options.onError === undefined) console.error(error);
    else options.onError(error);
  };
  let timer: unknown;
  let armed = false;
  let stale = false;
  let running = false;
  let again = false;
  let disposed = false;

  function arm(): void {
    if (armed || disposed) return;
    armed = true;
    timer = timers.setTimeout(() => {
      armed = false;
      start();
    }, windowMs);
  }

  function disarm(): void {
    if (!armed) return;
    armed = false;
    timers.clearTimeout(timer);
  }

  function finish(): void {
    running = false;
    if (again || stale) {
      again = false;
      stale = true;
      arm();
    }
  }

  function start(): void {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    stale = false;
    let result: unknown;
    try {
      result = options.run();
    } catch (error) {
      report(error);
      finish();
      return;
    }
    if (result instanceof Promise) {
      result.then(finish, (error: unknown) => {
        report(error);
        finish();
      });
    } else {
      finish();
    }
  }

  return {
    markStale() {
      if (disposed) return;
      stale = true;
      if (running) again = true;
      else arm();
    },
    runNow() {
      disarm();
      start();
    },
    dispose() {
      disposed = true;
      disarm();
    },
    get stale() {
      return stale;
    },
    get running() {
      return running;
    },
  };
}
