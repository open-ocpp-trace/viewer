import type { TraceRecord } from "@open-ocpp-trace/core";
import { describe, expect, it } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type CorrelationChange,
  type TraceEntry,
} from "@open-ocpp-trace/viewer-core";

import { call, correlate, error, result } from "./correlation-fixtures.ts";
import { deepFreeze, gap, unparsed } from "./store-fixtures.ts";

describe("Correlator rule", () => {
  it("correlates a response with its CALL and derives the response action", () => {
    const { correlator } = correlate([call("c1", "m1"), result("r1", "m1")]);

    expect(correlator.get("c1")).toEqual({
      role: "call",
      messageId: "m1",
      action: "Heartbeat",
      responseId: "r1",
    });
    expect(correlator.get("r1")).toEqual({
      role: "response",
      messageId: "m1",
      callId: "c1",
      action: "Heartbeat",
      candidates: [],
      candidatesTruncated: false,
    });
    expect(correlator.unansweredCalls()).toEqual([]);
    expect(correlator.orphanResponses()).toEqual([]);
  });

  it("correlates a CALLERROR in the opposite direction", () => {
    const { correlator } = correlate([
      call("c1", "m1", { direction: "csms-to-cp", action: "Reset" }),
      error("e1", "m1", { direction: "cp-to-csms" }),
    ]);

    expect(correlator.get("e1")).toMatchObject({ role: "response", callId: "c1", action: "Reset" });
    expect(correlator.get("c1")).toMatchObject({ responseId: "e1" });
  });

  it("follows reused message ids in order", () => {
    const { correlator } = correlate([
      call("c1", "1"),
      result("r1", "1"),
      call("c2", "1"),
      result("r2", "1"),
    ]);

    expect(correlator.get("r1")).toMatchObject({ callId: "c1", candidates: [] });
    expect(correlator.get("r2")).toMatchObject({ callId: "c2", candidates: [] });
  });

  it("falls back to an older unanswered CALL when the newest is answered", () => {
    const { correlator } = correlate([
      call("c1", "m1"),
      call("c2", "m1"),
      result("r1", "m1"),
      result("r2", "m1"),
    ]);

    // r1 follows the rule, but c1 could have been its CALL too: explicit.
    expect(correlator.get("r1")).toMatchObject({ callId: "c2", candidates: ["c1"] });
    expect(correlator.get("r2")).toMatchObject({ callId: "c1", candidates: [] });
    expect(correlator.unansweredCalls()).toEqual([]);
  });

  it("never correlates a response with a CALL in the same direction", () => {
    const { correlator } = correlate([
      call("c1", "m1"),
      result("r1", "m1", { direction: "cp-to-csms" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ role: "orphan", candidates: [] });
    expect(correlator.unansweredCalls()).toEqual(["c1"]);
  });

  it("never correlates a response with a later CALL", () => {
    const { correlator } = correlate([result("r1", "m1"), call("c1", "m1")]);

    expect(correlator.get("r1")).toMatchObject({ role: "orphan" });
    expect(correlator.unansweredCalls()).toEqual(["c1"]);
  });

  it("keeps only the explicit action of an orphan response", () => {
    const { correlator } = correlate([
      result("r1", "m1", { action: "Authorize" }),
      error("e1", "m2"),
    ]);

    expect(correlator.get("r1")).toEqual({
      role: "orphan",
      messageId: "m1",
      action: "Authorize",
      candidates: [],
      candidatesTruncated: false,
      incompleteHistory: false,
    });
    expect(correlator.get("e1")).not.toHaveProperty("action");
    expect(correlator.orphanResponses()).toEqual(["r1", "e1"]);
  });

  it("uses the CALL action over the response's own", () => {
    const { correlator } = correlate([
      call("c1", "m1", { action: "BootNotification" }),
      result("r1", "m1", { action: "Heartbeat" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ action: "BootNotification" });
  });

  it("lists unanswered CALLs and orphan responses in list order", () => {
    const { correlator } = correlate([
      call("c1", "m1"),
      result("r9", "m9"),
      call("c2", "m2"),
      result("r2", "m2"),
      call("c3", "m3"),
      result("r8", "m8"),
    ]);

    expect(correlator.unansweredCalls()).toEqual(["c1", "c3"]);
    expect(correlator.orphanResponses()).toEqual(["r9", "r8"]);
    expect(correlator.get("c1")).not.toHaveProperty("responseId");
  });

  it("returns undefined for gaps, unparsed entries and unknown ids", () => {
    const { correlator } = correlate([gap("g1"), unparsed("u1"), call("c1", "m1")]);

    expect(correlator.get("g1")).toBeUndefined();
    expect(correlator.get("u1")).toBeUndefined();
    expect(correlator.get("nope")).toBeUndefined();
  });

  it("returns the same result object until it changes", () => {
    const { correlator } = correlate([call("c1", "m1")]);

    expect(correlator.get("c1")).toBe(correlator.get("c1"));
    expect(Object.isFrozen(correlator.get("c1"))).toBe(true);
  });
});

describe("Correlator scope", () => {
  it("defaults to the conversation scope and rejects unknown scopes", () => {
    expect(createCorrelator().scope).toBe("conversation");
    expect(createCorrelator({ scope: "global" }).scope).toBe("global");
    expect(() => createCorrelator({ scope: "tenant" as never })).toThrow(RangeError);
  });

  it("keeps interleaved charge points apart", () => {
    const { correlator } = correlate([
      call("c1", "m1", { chargePointId: "CP-1" }),
      call("c2", "m1", { chargePointId: "CP-2" }),
      result("r1", "m1", { chargePointId: "CP-1" }),
      result("r2", "m1", { chargePointId: "CP-2" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ callId: "c1", candidates: [] });
    expect(correlator.get("r2")).toMatchObject({ callId: "c2", candidates: [] });
  });

  it("keeps interleaved sessions of one charge point apart", () => {
    const { correlator } = correlate([
      call("c1", "m1", { sessionId: "S1" }),
      call("c2", "m1", { sessionId: "S2" }),
      result("r1", "m1", { sessionId: "S1" }),
      result("r2", "m1", { sessionId: "S2" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ callId: "c1", candidates: [] });
    expect(correlator.get("r2")).toMatchObject({ callId: "c2", candidates: [] });
  });

  it("never correlates across two different known sessions", () => {
    const { correlator } = correlate([
      call("c1", "m1", { sessionId: "S1" }),
      result("r1", "m1", { sessionId: "S2" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ role: "orphan", candidates: [] });
    expect(correlator.unansweredCalls()).toEqual(["c1"]);
  });

  it("reads the effective charge point with the record first", () => {
    const { correlator } = correlate([
      call("c1", "m1", { chargePointId: null, metadataChargePointId: "CP-2" }),
      result("r1", "m1", { chargePointId: "CP-1", metadataChargePointId: "CP-2" }),
      call("c2", "m2", { chargePointId: "CP-1", metadataChargePointId: "CP-9" }),
      result("r2", "m2", { chargePointId: null, metadataChargePointId: "CP-1" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ role: "orphan", candidates: [] });
    expect(correlator.get("r2")).toMatchObject({ role: "response", callId: "c2" });
  });

  it("ignores the session in the chargePoint scope", () => {
    const entries = [
      call("c1", "m1", { sessionId: "S1" }),
      result("r1", "m1", { sessionId: "S2" }),
    ];

    expect(correlate(entries, "chargePoint").correlator.get("r1")).toMatchObject({
      callId: "c1",
    });
  });

  it("ignores every key in the global scope", () => {
    const entries = [
      call("c1", "m1", { chargePointId: "CP-1", sessionId: "S1" }),
      result("r1", "m1", { chargePointId: "CP-2", sessionId: "S2" }),
    ];

    expect(correlate(entries, "global").correlator.get("r1")).toMatchObject({ callId: "c1" });
    expect(correlate(entries, "chargePoint").correlator.get("r1")).toMatchObject({
      role: "orphan",
    });
  });

  it("treats a trace without any charge point or session like the global scope", () => {
    const entries = [
      call("c1", "m1", { chargePointId: null }),
      call("c2", "m1", { chargePointId: null }),
      result("r1", "m1", { chargePointId: null }),
      result("r2", "m1", { chargePointId: null }),
      result("r3", "m1", { chargePointId: null }),
    ];
    const scoped = correlate(entries).correlator;
    const global = correlate(entries, "global").correlator;

    for (const id of ["c1", "c2", "r1", "r2", "r3"]) {
      expect(scoped.get(id)).toEqual(global.get(id));
    }
    expect(scoped.get("r1")).toMatchObject({ callId: "c2", candidates: ["c1"] });
    expect(scoped.get("r3")).toMatchObject({ role: "orphan", candidates: ["c2", "c1"] });
  });

  it("never matches a known key with an unknown one, but lists it as a candidate", () => {
    const { correlator } = correlate([
      call("c1", "m1", { sessionId: "S1" }),
      result("r1", "m1"),
      call("c2", "m2", { chargePointId: null }),
      result("r2", "m2", { chargePointId: "CP-1" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ role: "orphan", candidates: ["c1"] });
    expect(correlator.get("r2")).toMatchObject({ role: "orphan", candidates: ["c2"] });
    expect(correlator.unansweredCalls()).toEqual(["c1", "c2"]);
  });

  it("lists unanswered CALLs with an unknown key as candidates of a match", () => {
    const { correlator } = correlate([
      call("c1", "m1"),
      call("c2", "m1", { sessionId: "S1" }),
      call("c3", "m1", { sessionId: "S2" }),
      result("r1", "m1", { sessionId: "S1" }),
    ]);

    expect(correlator.get("r1")).toMatchObject({ callId: "c2", candidates: ["c1"] });
  });

  it("lists answered CALLs as candidates of an orphan", () => {
    const { correlator } = correlate([call("c1", "m1"), result("r1", "m1"), result("r2", "m1")]);

    expect(correlator.get("r2")).toMatchObject({ role: "orphan", candidates: ["c1"] });
  });
});

describe("Correlator candidates bound", () => {
  function calls(count: number, sessionOf: (i: number) => string | undefined): TraceEntry[] {
    return Array.from({ length: count }, (_, i) => {
      const sessionId = sessionOf(i);
      return call(`c${i}`, "m1", sessionId === undefined ? {} : { sessionId });
    });
  }

  it("keeps the 8 newest candidates and says it truncated them", () => {
    const { correlator } = correlate([...calls(9, (i) => `S${i}`), result("r1", "m1")]);

    expect(correlator.get("r1")).toMatchObject({
      role: "orphan",
      candidates: ["c8", "c7", "c6", "c5", "c4", "c3", "c2", "c1"],
      candidatesTruncated: true,
    });
  });

  it("does not truncate exactly 8 candidates", () => {
    const { correlator } = correlate([...calls(8, (i) => `S${i}`), result("r1", "m1")]);

    expect(correlator.get("r1")).toMatchObject({ candidatesTruncated: false });
  });

  it("scans only the 64 newest CALLs with that message id", () => {
    const within = correlate([
      ...calls(64, (i) => (i === 0 ? undefined : `other-${i}`)),
      result("r1", "m1", { sessionId: "mine" }),
    ]).correlator;
    const beyond = correlate([
      ...calls(65, (i) => (i === 0 ? undefined : `other-${i}`)),
      result("r1", "m1", { sessionId: "mine" }),
    ]).correlator;

    expect(within.get("r1")).toMatchObject({ candidates: ["c0"], candidatesTruncated: false });
    expect(beyond.get("r1")).toMatchObject({ candidates: [], candidatesTruncated: true });
  });
});

describe("Correlator untrusted records", () => {
  function withRecord(id: string, record: Record<string, unknown>): TraceEntry {
    return deepFreeze({ kind: "trace", id, record: record as unknown as TraceRecord });
  }

  it("treats __proto__ and constructor message ids as plain data", () => {
    const { correlator } = correlate([
      call("c1", "__proto__"),
      call("c2", "constructor"),
      result("r2", "constructor"),
      result("r1", "__proto__"),
    ]);

    expect(correlator.get("r1")).toMatchObject({ callId: "c1" });
    expect(correlator.get("r2")).toMatchObject({ callId: "c2" });
    expect(correlator.get("__proto__")).toBeUndefined();
  });

  it("ignores records it cannot correlate without throwing", () => {
    const base = call("c0", "m1").record;
    const { correlator } = correlate([
      withRecord("x1", { ...base, messageId: 1 }),
      withRecord("x2", { ...base, messageType: "CALLX" }),
      withRecord("x3", { ...base, direction: "sideways" }),
      withRecord("x4", { ...base, action: undefined }),
      withRecord("x5", { ...base, direction: 0 }),
      result("r1", "m1"),
    ]);

    for (const id of ["x1", "x2", "x3", "x4", "x5"]) expect(correlator.get(id)).toBeUndefined();
    expect(correlator.get("r1")).toMatchObject({ role: "orphan", candidates: [] });
  });

  it("treats a non-string charge point or session as unknown", () => {
    const base = call("c0", "m1").record;
    const { correlator } = correlate([
      withRecord("c1", { ...base, chargePointId: 42 }),
      { ...result("r1", "m1"), metadata: { sessionId: 7 as unknown as string } },
    ]);

    expect(correlator.get("r1")).toMatchObject({ role: "orphan", candidates: ["c1"] });
  });

  it("treats a record that throws when read as uncorrelatable", () => {
    let reads = 0;
    const record = { ...call("c0", "m1").record };
    Object.defineProperty(record, "messageId", {
      enumerable: true,
      get() {
        reads += 1;
        // The store reads it once to estimate the entry's weight.
        if (reads > 1) throw new Error("hostile");
        return "m1";
      },
    });
    const store = createViewerStore();
    store.load([{ kind: "trace", id: "c1", record: record as TraceRecord }]);
    const correlator = createCorrelator();

    expect(() => correlator.connect(store)).not.toThrow();
    expect(store.size).toBe(1);
    expect(correlator.get("c1")).toBeUndefined();
  });
});

describe("Correlator listeners", () => {
  it("emits one change for the seeded entries", () => {
    const store = createViewerStore();
    store.load([call("c1", "m1"), gap("g1"), result("r1", "m1"), call("c2", "m2")]);
    const correlator = createCorrelator();
    const changes: CorrelationChange[] = [];
    correlator.subscribe((change) => changes.push(change));

    expect(correlator.version).toBe(0);
    correlator.connect(store);

    expect(changes).toEqual([
      { version: 1, changed: ["c1", "r1", "c2"], removed: [], cleared: false },
    ]);
    expect(correlator.version).toBe(1);
  });

  it("does not emit when nothing correlates", () => {
    const store = createViewerStore();
    store.load([gap("g1")]);
    const correlator = createCorrelator();
    const changes: CorrelationChange[] = [];
    correlator.subscribe((change) => changes.push(change));
    correlator.connect(store);

    expect(changes).toEqual([]);
    expect(correlator.version).toBe(0);
  });

  it("runs every listener and reports each listener error instead of throwing it", () => {
    const store = createViewerStore();
    store.load([call("c1", "m1")]);
    const reported: unknown[] = [];
    const correlator = createCorrelator({ onError: (error) => reported.push(error) });
    const calls: string[] = [];
    correlator.subscribe(() => {
      calls.push("first");
      throw new Error("first");
    });
    correlator.subscribe(() => {
      calls.push("second");
      throw new Error("second");
    });
    const unsubscribe = correlator.subscribe(() => calls.push("third"));
    unsubscribe();
    unsubscribe();

    expect(() => correlator.connect(store)).not.toThrow();
    expect(calls).toEqual(["first", "second"]);
    expect(reported).toEqual([new Error("first"), new Error("second")]);
  });

  it("refuses a second store while connected", () => {
    const correlator = createCorrelator();
    correlator.connect(createViewerStore());

    expect(() => correlator.connect(createViewerStore())).toThrow(Error);
  });
});
