import type { TraceEntry } from "@open-ocpp-trace/viewer-core";

export interface ReplayOptions {
  /** The captured entries; replayed by record timestamp, ties in given order. */
  readonly entries: readonly TraceEntry[];
  readonly push: (entries: readonly TraceEntry[]) => void;
  /** Delay between two entries. */
  readonly intervalMs: number;
  /** Called after every state change: a push, play, pause or the end. */
  readonly onChange?: () => void;
}

/** A timer replaying a capture, one entry per tick, as live traffic would arrive. */
export interface Replay {
  readonly playing: boolean;
  /** Entries pushed so far. */
  readonly position: number;
  readonly total: number;
  readonly done: boolean;
  play(): void;
  pause(): void;
}

function time(entry: TraceEntry): number {
  const parsed = Date.parse(entry.record.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function createReplay(options: ReplayOptions): Replay {
  // Array.prototype.sort is stable: equal timestamps keep their order.
  const queue = [...options.entries].sort((a, b) => time(a) - time(b));
  let position = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const tick = (): void => {
    const next = queue[position];
    if (next !== undefined) {
      position += 1;
      options.push([next]);
    }
    if (position >= queue.length) stop();
    options.onChange?.();
  };

  return {
    get playing() {
      return timer !== undefined;
    },
    get position() {
      return position;
    },
    get total() {
      return queue.length;
    },
    get done() {
      return position >= queue.length;
    },
    play() {
      if (timer !== undefined || position >= queue.length) return;
      timer = setInterval(tick, options.intervalMs);
      options.onChange?.();
    },
    pause() {
      if (timer === undefined) return;
      stop();
      options.onChange?.();
    },
  };
}
