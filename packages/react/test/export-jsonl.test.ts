import { describe, expect, it } from "vite-plus/test";

import { parseRecord, readRecords } from "@open-ocpp-trace/jsonl/reader";
import type { TraceEntry, ViewerEntry } from "@open-ocpp-trace/viewer-core";
import { exportJsonl } from "@open-ocpp-trace/viewer-react";

import { sdkEntry } from "./fixtures.ts";

/** Freezes `value` and everything it holds, without recursion. */
function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "object" || current === null || Object.isFrozen(current)) continue;
    Object.freeze(current);
    for (const key of Object.keys(current)) stack.push((current as Record<string, unknown>)[key]);
  }
  return value;
}

/** A trace entry around `record`, bypassing the reader's validation. */
function rawEntry(id: string, record: Record<string, unknown>): TraceEntry {
  return { kind: "trace", id, record: record as unknown as TraceEntry["record"] };
}

/** A payload nested `depth` objects deep, built with a loop. */
function deepPayload(depth: number): Record<string, unknown> {
  let payload: Record<string, unknown> = {};
  for (let level = 0; level < depth; level += 1) payload = { next: payload };
  return payload;
}

function lines(text: string): string[] {
  expect(text.endsWith("\n")).toBe(true);
  return text.slice(0, -1).split("\n");
}

const FIXTURES: readonly TraceEntry[] = [
  sdkEntry("call", { raw: '[2,"m-call","Heartbeat",{}]', meta: { probe: { line: 3 } } }),
  sdkEntry("call-bare"),
  sdkEntry("call-no-payload", { payload: undefined }),
  sdkEntry("result", {
    messageType: "CALLRESULT",
    direction: "csms-to-cp",
    action: undefined,
    payload: { currentTime: "2026-11-09T10:00:01.000Z" },
    raw: '[3,"m-result",{"currentTime":"2026-11-09T10:00:01.000Z"}]',
  }),
  sdkEntry("result-no-payload", {
    messageType: "CALLRESULT",
    action: undefined,
    payload: undefined,
  }),
  sdkEntry("error", {
    messageType: "CALLERROR",
    direction: "csms-to-cp",
    payload: undefined,
    error: { code: "InternalError", description: "boom", details: { at: ["a", 1, null] } },
    raw: '[4,"m-error","InternalError","boom",{"at":["a",1,null]}]',
    meta: { gateway: "gw-1" },
  }),
  sdkEntry("error-bare", { messageType: "CALLERROR", payload: undefined, error: {} }),
];

describe("exportJsonl()", () => {
  it("writes only trace entries, in input order, and counts the others", () => {
    const entries: ViewerEntry[] = [
      sdkEntry("b", { messageId: "m-2" }),
      { kind: "gap", id: "g", reason: "disconnected" },
      { kind: "unparsed", id: "u", raw: "not json", reason: "invalid JSON" },
      sdkEntry("a", { messageId: "m-1" }),
      { kind: "gap", id: "g2", reason: "dropped", missedCount: 3 },
    ];

    const exported = exportJsonl(entries);

    expect(exported.recordCount).toBe(2);
    expect(exported.skipped).toEqual({ unparsed: 1, gap: 2, invalid: 0 });
    const ids = lines(exported.text).map((line) => JSON.parse(line).messageId);
    expect(ids).toEqual(["m-2", "m-1"]);
  });

  it("round-trips every message type through the SDK reader", async () => {
    const exported = exportJsonl(FIXTURES);

    expect(exported.recordCount).toBe(FIXTURES.length);
    const parsed = lines(exported.text).map((line) => {
      const result = parseRecord(line);
      if (!result.ok) throw result.error;
      return result.record;
    });
    expect(parsed).toEqual(FIXTURES.map((entry) => entry.record));

    const read: unknown[] = [];
    for await (const result of readRecords([exported.text])) read.push(result);
    expect(read).toHaveLength(FIXTURES.length);
  });

  it("never mutates entries and never writes viewer fields", () => {
    const entries = deepFreeze<ViewerEntry[]>(
      FIXTURES.map((entry) => ({
        ...entry,
        receivedAt: "2026-11-09T10:00:05.000Z",
        metadata: { tenant: "tenant-secret", custom: { note: "viewer-only" } },
      })),
    );

    const exported = exportJsonl(entries);

    expect(exported.recordCount).toBe(FIXTURES.length);
    for (const text of ["receivedAt", "metadata", "tenant-secret", "viewer-only"]) {
      expect(exported.text).not.toContain(text);
    }
  });

  it("skips a record the writer rejects as invalid", () => {
    const { timestamp: _dropped, ...withoutTimestamp } = FIXTURES[1]!.record;
    const entries = [rawEntry("bad", withoutTimestamp), FIXTURES[0]!];

    const exported = exportJsonl(entries);

    expect(exported.recordCount).toBe(1);
    expect(exported.skipped).toEqual({ unparsed: 0, gap: 0, invalid: 1 });
    expect(lines(exported.text)).toHaveLength(1);
  });

  // Whether `JSON.stringify` overflows at this depth depends on the stack
  // size of the runtime: the writer then reports an `unserializable` error.
  it("exports or skips a payload 100 000 levels deep, never throws", () => {
    const deep = rawEntry("deep", { ...FIXTURES[1]!.record, payload: deepPayload(100_000) });

    const exported = exportJsonl([deep, FIXTURES[1]!]);

    expect(exported.recordCount + exported.skipped.invalid).toBe(2);
    expect(lines(exported.text)).toHaveLength(exported.recordCount);
  });

  it("exports nothing from an empty input", () => {
    expect(exportJsonl([])).toEqual({
      text: "",
      recordCount: 0,
      skipped: { unparsed: 0, gap: 0, invalid: 0 },
    });
  });

  it("propagates an error that is not a write error", () => {
    const failing: Iterable<ViewerEntry> = {
      *[Symbol.iterator]() {
        yield FIXTURES[0]!;
        throw new TypeError("source failed");
      },
    };

    expect(() => exportJsonl(failing)).toThrow("source failed");
  });
});
