import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type TraceEntry,
  type ViewerEntry,
} from "@open-ocpp-trace/viewer-core";
import { EntryInspector, TraceViewer } from "@open-ocpp-trace/viewer-react";

import { stubLayout } from "./layout.ts";

stubLayout();

const HOSTILE = [
  "<img src=x onerror=alert(1)>",
  "<script>alert(1)</script>",
  "javascript:alert(1)",
  "https://evil.example/x.png",
  '<iframe src="https://evil.example"></iframe>',
  '<a href="javascript:alert(1)">x</a>',
] as const;
const ALL = HOSTILE.join(" ");

/** A trace entry built without the SDK reader, which cannot parse a 100 000-deep line. */
function hostileEntry(id: string, fields: Record<string, unknown>): TraceEntry {
  const record = {
    schemaVersion: "1.1",
    timestamp: "2026-11-09T10:00:00.000Z",
    transport: "json",
    direction: "cp-to-csms",
    messageType: "CALL",
    messageId: `m-${id}`,
    action: "DataTransfer",
    ...fields,
  };
  return { kind: "trace", id, record: record as unknown as TraceEntry["record"] };
}

/** Feeds `entry` through a real store and correlator, then inspects it. */
function inspect(entry: ViewerEntry, maxChars = 1000): HTMLElement {
  const store = createViewerStore();
  const correlator = createCorrelator();
  correlator.connect(store);
  store.load([entry]);
  render(
    <EntryInspector
      store={store}
      correlator={correlator}
      entryId={entry.id}
      onNavigate={() => {}}
      onCopy={() => {}}
      revealSensitive
      maxChars={maxChars}
    />,
  );
  return screen.getByRole("region", { name: "Entry details" });
}

function expectInert(root: HTMLElement): void {
  expect(root.querySelectorAll("img, script, a, iframe, object, embed").length).toBe(0);
  expect(root.querySelectorAll("[href], [src], [onerror], [style], [srcset]").length).toBe(0);
}

/** Nests `depth` objects with a loop: a recursive builder would overflow. */
function deep(depth: number): unknown {
  let value: unknown = "bottom";
  for (let i = 0; i < depth; i++) value = { next: value };
  return value;
}

describe("<EntryInspector> with hostile content", () => {
  it("renders markup and URLs of a record and its metadata as text", () => {
    const entry = hostileEntry("x", {
      messageType: "CALLERROR",
      chargePointId: HOSTILE[0],
      error: { code: HOSTILE[1], description: HOSTILE[2], details: { html: ALL } },
      payload: { html: ALL, [HOSTILE[0]]: HOSTILE[3] },
      raw: ALL,
      meta: { html: ALL },
    });
    const root = inspect(
      {
        ...entry,
        metadata: {
          tenant: HOSTILE[4],
          source: { id: HOSTILE[5], label: HOSTILE[3] },
          deliveries: [{ target: HOSTILE[3], status: HOSTILE[0], reason: HOSTILE[1] }],
          custom: { html: ALL },
        },
      },
      100_000,
    );
    expectInert(root);
    for (const text of HOSTILE) expect(root.textContent).toContain(text);
    expect(screen.getByLabelText("Raw frame", { selector: "pre" }).textContent).toBe(ALL);
  });

  it("renders an unparsed frame and a gap reason as text", () => {
    const root = inspect({ kind: "unparsed", id: "u", raw: ALL, reason: HOSTILE[0] });
    expectInert(root);
    expect(root.textContent).toContain(HOSTILE[0]);
    expect(root.textContent).toContain(HOSTILE[1]);
  });

  it("renders a hostile gap reason as text", () => {
    const root = inspect({ kind: "gap", id: "g", reason: ALL });
    expectInert(root);
    expect(root.textContent).toContain(ALL);
  });
});

describe("<EntryInspector> with large payloads", () => {
  it("slices a 10 MB raw frame", () => {
    const raw = "r".repeat(10 * 1024 * 1024);
    const root = inspect(hostileEntry("big", { payload: { small: true }, raw }));
    expect(screen.getByLabelText("Raw frame", { selector: "pre" }).textContent).toHaveLength(1000);
    expect(root.textContent!.length).toBeLessThan(5000);
  });

  it("slices a 10 MB unparsed frame", () => {
    const root = inspect({
      kind: "unparsed",
      id: "u",
      raw: "u".repeat(10 * 1024 * 1024),
      reason: "r",
    });
    expect(root.textContent!.length).toBeLessThan(5000);
  });

  it("prints a 1 000 000-key payload up to maxChars", () => {
    const payload: Record<string, number> = {};
    for (let i = 0; i < 1_000_000; i++) payload[`k${i}`] = i;
    const root = inspect(hostileEntry("wide", { payload }));
    expect(screen.getByLabelText("Payload", { selector: "pre" }).textContent).toHaveLength(1000);
    expect(root.textContent!.length).toBeLessThan(5000);
  });

  it("prints a 100 000-deep payload without overflowing the stack", () => {
    const root = inspect(hostileEntry("deep", { payload: deep(100_000), meta: deep(100_000) }));
    expect(screen.getByLabelText("Payload", { selector: "pre" }).textContent).toHaveLength(1000);
    expect(root.textContent!.length).toBeLessThan(5000);
  });

  it("lists and searches hostile payloads in the trace viewer", () => {
    const wide: Record<string, string> = {};
    for (let i = 0; i < 1_000_000; i++) wide[`k${i}`] = "hay";
    for (const payload of [deep(100_000), wide, { text: "x".repeat(10 * 1024 * 1024) }]) {
      const store = createViewerStore();
      store.load([hostileEntry("h", { payload })]);
      const { unmount } = render(
        <TraceViewer
          store={store}
          payloadSearch
          defaultFilter={{ text: "needle", searchPayloads: true }}
          defaultSelection={{ entryId: "h" }}
        />,
      );
      // A stack overflow in the search would be a RangeError the filter
      // panel turns into an alert, leaving the grid rendered.
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("No entries match the filter")).toBeTruthy();
      expect(store.get("h")).toBeDefined();
      unmount();
    }
  });
});
