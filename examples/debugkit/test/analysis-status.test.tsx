import { render, screen } from "@testing-library/react";
import type { TraceRecord } from "@open-ocpp-trace/core";
import type { ViewerEntry } from "@open-ocpp-trace/viewer-core";
import { describe, expect, it } from "vite-plus/test";

import { analyzeSnapshot } from "../src/analysis.ts";
import { AnalysisStatus } from "../src/AnalysisStatus.tsx";
import { createExampleStore } from "../src/example-store.ts";
import { buildSnapshot } from "../src/snapshot.ts";

function heartbeat(index: number, messageId?: string): ViewerEntry {
  const record: TraceRecord = {
    schemaVersion: "1.1",
    timestamp: `2024-01-15T14:00:0${index}.000Z`,
    transport: "json",
    direction: "cp-to-csms",
    messageType: "CALL",
    action: "Heartbeat",
    payload: {},
    ...(messageId === undefined ? {} : { messageId }),
  };
  return { kind: "trace", id: `hb:${index}`, record };
}

function statusText(): string {
  return screen.getByRole("region", { name: "DebugKit analysis" }).textContent ?? "";
}

describe("AnalysisStatus", () => {
  it("counts what was sent, mapped and left out, and lists DebugKit's warnings verbatim", async () => {
    const store = await createExampleStore();
    const analysis = analyzeSnapshot(buildSnapshot(store.toArray()));

    render(<AnalysisStatus analysis={analysis} stale={false} />);

    const text = statusText();
    expect(text).toContain(`Snapshot: ${analysis.snapshot.lines.length} lines`);
    expect(text).toContain(`DebugKit events: ${analysis.events.length}`);
    expect(text).toContain("Unmapped entries: 3 (2 ambiguous)");
    expect(text).toContain("Unmatched events: 1");
    expect(text).toContain("Not sent: 1 unparsed, 0 gaps, 0 invalid");
    const warnings = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(warnings).toEqual(analysis.warnings.map((warning) => warning.message));
    expect(warnings).toHaveLength(4);
    expect(text).not.toContain("truncated");
    expect(text).not.toContain("artifacts of the truncation");
  });

  it("warns that failures near the cut may be artifacts of the truncation", () => {
    const entries = [heartbeat(1, "a"), heartbeat(2, "b"), heartbeat(3, "c")];
    const analysis = analyzeSnapshot(
      buildSnapshot(entries, { maxLines: 2, maxBytes: 1024 * 1024 }),
    );

    render(<AnalysisStatus analysis={analysis} stale={false} />);

    expect(statusText()).toContain(
      "Failures near the start of the snapshot (orphan responses, sessions without a start) may be artifacts of the truncation.",
    );
  });

  it("says when the snapshot was truncated and when it is stale", () => {
    const entries = [heartbeat(1, "a"), heartbeat(2, "b"), heartbeat(3, "c")];
    const analysis = analyzeSnapshot(
      buildSnapshot(entries, { maxLines: 2, maxBytes: 1024 * 1024 }),
    );

    render(<AnalysisStatus analysis={analysis} stale />);

    expect(statusText()).toContain("the 1 oldest trace entries were left out (snapshot limits)");
    expect(statusText()).toContain("The trace changed since this analysis");
  });

  it("shows DebugKit's ParseError message and a broken mapping's reason", () => {
    const rejected = analyzeSnapshot(buildSnapshot([heartbeat(1)]));

    render(<AnalysisStatus analysis={rejected} stale={false} />);

    expect(statusText()).toContain(
      "DebugKit rejected the snapshot: Trace contains no valid Open OCPP Trace records.",
    );
  });

  it("shows why the mapping was dropped", () => {
    const analysis = analyzeSnapshot(buildSnapshot([heartbeat(1, "a")]), () => ({
      events: [
        {
          id: "evt-0001",
          messageId: "other",
          timestamp: 0,
          direction: "CSMS_TO_CS",
          messageType: "CallResult",
          action: null,
          payload: {},
          errorCode: null,
          errorDescription: null,
          rawMessage: [3, "other", {}],
        },
      ],
      warnings: [],
    }));

    render(<AnalysisStatus analysis={analysis} stale={false} />);

    expect(statusText()).toContain(`Mapping dropped: ${analysis.mapping.reason}`);
  });

  it("waits for the first analysis", () => {
    render(<AnalysisStatus analysis={undefined} stale={false} />);

    expect(statusText()).toContain("Not analyzed yet");
  });
});
