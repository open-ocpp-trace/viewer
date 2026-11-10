import { afterEach, beforeEach } from "vite-plus/test";

const ROW_HEIGHT = 28;
// Tall enough for every row of the example to render at once.
const VIEWPORT_ROWS = 60;

const STUBBED = ["clientHeight", "clientWidth", "scrollHeight"] as const;

/**
 * happy-dom does no layout, so the viewer's virtualizer would render no row.
 * Give elements a fixed viewport and the grid the height of its rows, as
 * `packages/react/test/layout.ts` does, for the tests of the current file.
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
