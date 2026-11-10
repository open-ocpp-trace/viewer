// The bounded-memory acceptance criterion, end to end: the gateway feed
// drives a real mounted viewer-standalone, and the page's counters show both
// the adapter's and the viewer store's bounds at work.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { mount, type ViewerInstance } from "@open-ocpp-trace/viewer-standalone";

import { createCounterView, type CounterView } from "../src/counters.ts";
import { createGatewayFeed, type GatewayFeed } from "../src/feed.ts";
import { heartbeatDoc, hello } from "./fixtures.ts";

const MAX_BUFFERED = 3;

/** The page's markup, without its script. */
function loadPage(): void {
  const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");
  document.body.innerHTML = html.slice(html.indexOf("<main"), html.indexOf("</main>") + 7);
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`the page has no #${id} element`);
  return element;
}

function text(id: string): string | null {
  return byId(id).textContent;
}

/** Clicks the viewer's Pause toggle, which pauses or resumes its store. */
function togglePause(): void {
  const root = byId("viewer").querySelector(":scope > [data-oot-standalone]")?.shadowRoot;
  const button = Array.from(root?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === "Pause",
  );
  if (button === undefined) throw new Error("no Pause button");
  button.click();
}

let viewer: ViewerInstance | undefined;
let feed: GatewayFeed;
let view: CounterView;

function render(): void {
  view.render(feed.counters(), viewer?.getStats());
}

function burst(prefix: string, count: number): void {
  for (let i = 0; i < count; i += 1) {
    feed.receive("trace", JSON.stringify(heartbeatDoc(`${prefix}${i}`)));
  }
  render();
}

beforeEach(() => {
  loadPage();
  view = createCounterView(byId);
  // Mounted on the first hello with the gateway's buffer size, as main.ts does.
  feed = createGatewayFeed({
    onHello({ hello: received, first }) {
      if (first) {
        viewer = mount(byId("viewer"), {
          maxEntries: received.maxBufferedMessages,
          adapter: feed.adapter,
        });
      }
    },
  });
  feed.receive("hello", hello(MAX_BUFFERED));
});

afterEach(() => {
  viewer?.unmount();
  viewer = undefined;
  document.body.innerHTML = "";
});

describe("the page's counters against a mounted viewer", () => {
  it("shows the viewer's evictions and keeps the adapter's state bounded under a burst", () => {
    burst("t", 10 * MAX_BUFFERED);

    expect(viewer?.getStats()).toMatchObject({ listed: MAX_BUFFERED, evicted: 27 });
    expect(feed.trackedIds()).toHaveLength(feed.capacity);
    expect(feed.capacity).toBe(2 * MAX_BUFFERED);
    expect(text("viewer-listed")).toBe("3");
    expect(text("viewer-evicted")).toBe("27");
    expect(text("count-received")).toBe("30");
    expect(text("count-delivery-states-evicted")).toBe("24");
  });

  it("shows what a paused viewer holds and drops, then the resume", async () => {
    togglePause();
    render();
    burst("p", 5);

    // The pending budget keeps room for the gap resume() lists: one entry.
    expect(text("viewer-pending")).toBe("2");
    expect(text("viewer-dropped-pending")).toBe("3");
    expect(text("viewer-listed")).toBe("0");

    // The toggle reads the paused state React renders after the first click.
    await new Promise((resolve) => setTimeout(resolve, 0));
    togglePause();
    render();
    expect(text("viewer-pending")).toBe("0");
    // The two pending entries, after the gap of the three dropped ones.
    expect(text("viewer-listed")).toBe("3");
  });

  it("shows the updates the viewer ignored and the invalid batch items", () => {
    viewer?.update([
      { type: "update", id: "gone", metadata: { tenant: "t" } },
      { type: "mystery" } as never,
    ]);
    render();

    expect(text("viewer-unknown-updates")).toBe("1");
    expect(text("viewer-invalid")).toBe("1");
    expect(text("viewer-stale-updates")).toBe("0");
  });

  it("leaves the viewer counters as they are until the viewer is mounted", () => {
    view.render(feed.counters(), undefined);

    expect(text("viewer-listed")).toBe("0");
  });
});
