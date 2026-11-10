import { afterEach, beforeEach } from "vite-plus/test";

export const ROW_HEIGHT = 28;
export const VIEWPORT_ROWS = 10;

const STUBBED = ["clientHeight", "clientWidth", "scrollHeight"] as const;

/**
 * happy-dom does no layout: every size is 0, so the virtualizer, which reads
 * the scroll element's clientHeight on mount, would render no row, and every
 * scroll would be clamped to 0. Give elements a fixed viewport, and the grid
 * the height of its rows (`aria-rowcount` counts the header row), for the
 * tests of the current file. `initialRect` would not help, as the first read
 * replaces it. happy-dom does not fire `scroll` either: tests fire it after a
 * scroll, as a browser would.
 */
export function stubLayout(): void {
  beforeEach(() => {
    const sizes: Record<(typeof STUBBED)[number], (element: HTMLElement) => number> = {
      clientHeight: () => ROW_HEIGHT * VIEWPORT_ROWS,
      clientWidth: () => 800,
      scrollHeight: (element) =>
        element.getAttribute("role") === "grid"
          ? Number(element.getAttribute("aria-rowcount")) * ROW_HEIGHT
          : 0,
    };
    for (const name of STUBBED) {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return sizes[name](this);
        },
      });
    }
  });

  afterEach(() => {
    for (const name of STUBBED) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });
}
