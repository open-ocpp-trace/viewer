import { describe, expect, it } from "vite-plus/test";

import { parseRecord, readRecords } from "@open-ocpp-trace/jsonl/reader";
import type { TraceEntry, ViewerEntry } from "@open-ocpp-trace/viewer-core";
import { exportJsonl } from "@open-ocpp-trace/viewer-react";
import type { JsonlExportOptions } from "@open-ocpp-trace/viewer-react";

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

/** Records whose sensitive values all start with `SECRET`. */
const SENSITIVE: readonly TraceEntry[] = [
  sdkEntry("authorize", {
    action: "Authorize",
    payload: { idTag: "SECRET-1", list: [{ IDTAG: "SECRET-2", kept: "visible-1" }] },
    raw: '[2,"m-authorize","Authorize",{"idTag":"SECRET-1","list":[{"IDTAG":"SECRET-2","kept":"visible-1"}]}]',
    meta: { gateway: "gw-1", auth: { password: "SECRET-3" } },
  }),
  sdkEntry("error", {
    messageType: "CALLERROR",
    action: undefined,
    payload: undefined,
    error: {
      code: "InternalError",
      description: "visible-2",
      details: { nested: [[{ parentIdTag: "SECRET-4" }]], kept: "visible-3" },
    },
    raw: '[4,"m-error","InternalError","visible-2",{"nested":[[{"parentIdTag":"SECRET-4"}]],"kept":"visible-3"}]',
  }),
  sdkEntry("unknown", {
    idToken: "SECRET-5",
    extension: { groupIdToken: { id: "SECRET-6" }, kept: "visible-4" },
  }),
  // The key is spelled with a JSON escape: only a parse of raw sees it.
  sdkEntry("escaped", {
    payload: { other: 1 },
    raw: '[2,"m-escaped","Heartbeat",{"\\u0069dTag":"SECRET-7"}]',
  }),
];

const REDACT: JsonlExportOptions = { redact: true };

function parsedLines(text: string): Record<string, unknown>[] {
  return lines(text).map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("exportJsonl({ redact: true })", () => {
  it("leaves no sensitive value anywhere and keeps the other values", () => {
    const exported = exportJsonl(SENSITIVE, REDACT);

    expect(exported.recordCount).toBe(SENSITIVE.length);
    expect(exported.text).not.toContain("SECRET");
    for (const kept of ["visible-1", "visible-2", "visible-3", "visible-4", "gw-1"]) {
      expect(exported.text).toContain(kept);
    }
    const [authorize, error, unknown] = parsedLines(exported.text);
    expect(authorize!["payload"]).toEqual({
      idTag: "[redacted]",
      list: [{ IDTAG: "[redacted]", kept: "visible-1" }],
    });
    expect(error!["error"]).toEqual({
      code: "InternalError",
      description: "visible-2",
      details: { nested: [[{ parentIdTag: "[redacted]" }]], kept: "visible-3" },
    });
    expect(unknown!["idToken"]).toBe("[redacted]");
    expect(unknown!["extension"]).toEqual({ groupIdToken: "[redacted]", kept: "visible-4" });
  });

  it("is the faithful export by default", () => {
    const faithful = SENSITIVE.map((entry) => `${JSON.stringify(entry.record)}\n`).join("");

    expect(exportJsonl(SENSITIVE).text).toBe(faithful);
    expect(exportJsonl(SENSITIVE, {}).text).toBe(faithful);
    expect(exportJsonl(SENSITIVE, { redact: false, sensitiveKeys: ["kept"] }).text).toBe(faithful);
    expect(exportJsonl(FIXTURES).text).toBe(
      FIXTURES.map((entry) => `${JSON.stringify(entry.record)}\n`).join(""),
    );
  });

  it("marks every record in meta, after redacting meta, and keeps producer keys", () => {
    const [authorize, error] = parsedLines(exportJsonl(SENSITIVE, REDACT).text);

    expect(authorize!["meta"]).toEqual({
      gateway: "gw-1",
      auth: { password: "[redacted]" },
      redaction: { by: "@open-ocpp-trace/viewer-react", rawDropped: true },
    });
    expect(error!["meta"]).toEqual({
      redaction: { by: "@open-ocpp-trace/viewer-react", rawDropped: true },
    });
    const [heartbeat] = parsedLines(exportJsonl([FIXTURES[1]!], REDACT).text);
    expect(heartbeat!["meta"]).toEqual({
      redaction: { by: "@open-ocpp-trace/viewer-react", rawDropped: false },
    });
  });

  it("keeps a raw frame verbatim when its parse holds no sensitive key", () => {
    const raw = '[2,  "m-call","Heartbeat",{ "n": 1.0 }]';
    const [record] = parsedLines(exportJsonl([sdkEntry("call", { raw })], REDACT).text);

    expect(record!["raw"]).toBe(raw);
    expect(record!["meta"]).toEqual({
      redaction: { by: "@open-ocpp-trace/viewer-react", rawDropped: false },
    });
  });

  it("drops a raw frame holding a sensitive key, even JSON-escaped", () => {
    const records = parsedLines(exportJsonl(SENSITIVE, REDACT).text);

    expect(records[0]).not.toHaveProperty("raw");
    expect(records[1]).not.toHaveProperty("raw");
    expect(records[3]).not.toHaveProperty("raw");
    expect(records[3]!["meta"]).toEqual({
      redaction: { by: "@open-ocpp-trace/viewer-react", rawDropped: true },
    });
  });

  it("drops a raw frame it cannot check: SOAP, not JSON, or too large", () => {
    const entries = [
      sdkEntry("soap", { transport: "soap", raw: '["no","sensitive","key"]' }),
      sdkEntry("xml", {
        transport: "soap",
        raw: "<soap:Envelope><idTag>SECRET</idTag></soap:Envelope>",
      }),
      sdkEntry("text", { raw: "not json" }),
      sdkEntry("large", { raw: `[2,"m-large","Heartbeat",{"pad":"${"x".repeat(1_000_000)}"}]` }),
    ];

    const records = parsedLines(exportJsonl(entries, REDACT).text);

    expect(records).toHaveLength(4);
    for (const record of records) {
      expect(record).not.toHaveProperty("raw");
      expect(record["meta"]).toEqual({
        redaction: { by: "@open-ocpp-trace/viewer-react", rawDropped: true },
      });
    }
  });

  it("never touches schema fields, even when listed as sensitive", () => {
    const keys = ["messageId", "action", "timestamp", "chargePointId", "payload", "meta", "code"];
    const entry = SENSITIVE[1]!;

    const [record] = parsedLines(exportJsonl([entry], { redact: true, sensitiveKeys: keys }).text);

    const {
      raw: _raw,
      meta: _meta,
      ...fields
    } = entry.record as unknown as Record<string, unknown>;
    expect(record).toMatchObject(fields);
  });

  it("keeps an unknown __proto__ field as a field, redacted", () => {
    const fields = JSON.parse('{"__proto__":{"idTag":"SECRET"}}') as Record<string, unknown>;

    const [record] = parsedLines(exportJsonl([sdkEntry("proto", fields)], REDACT).text);

    expect(Object.hasOwn(record!, "__proto__")).toBe(true);
    expect(JSON.stringify(record)).toContain('"__proto__":{"idTag":"[redacted]"}');
  });

  it("matches the given sensitive keys instead of the defaults", () => {
    const [record] = parsedLines(
      exportJsonl([SENSITIVE[0]!], { redact: true, sensitiveKeys: ["KEPT"] }).text,
    );

    expect(record!["payload"]).toEqual({
      idTag: "SECRET-1",
      list: [{ IDTAG: "SECRET-2", kept: "[redacted]" }],
    });
  });

  it("round-trips through the SDK reader", async () => {
    const entries = [...FIXTURES, ...SENSITIVE];
    const exported = exportJsonl(entries, REDACT);

    expect(exported.recordCount).toBe(entries.length);
    for (const line of lines(exported.text)) {
      const result = parseRecord(line);
      if (!result.ok) throw result.error;
      expect(result.record.meta?.["redaction"]).toBeDefined();
    }
    const read: unknown[] = [];
    for await (const result of readRecords([exported.text])) read.push(result);
    expect(read).toHaveLength(entries.length);
  });

  it("never mutates entries", () => {
    const entries = deepFreeze<ViewerEntry[]>([...SENSITIVE]);
    const before = JSON.stringify(entries);

    expect(exportJsonl(entries, REDACT).recordCount).toBe(SENSITIVE.length);
    expect(JSON.stringify(entries)).toBe(before);
  });

  it("exports or skips a payload 100 000 levels deep, never throws", () => {
    let payload: Record<string, unknown> = { idTag: "SECRET" };
    for (let level = 0; level < 100_000; level += 1) payload = { next: payload };
    const deep = rawEntry("deep", { ...FIXTURES[1]!.record, payload });

    const exported = exportJsonl([deep, FIXTURES[1]!], REDACT);

    expect(exported.recordCount + exported.skipped.invalid).toBe(2);
    expect(exported.text).not.toContain("SECRET");
  });

  it("skips a record it cannot read or that holds a cycle", () => {
    const cyclic: Record<string, unknown> = { idTag: "SECRET" };
    cyclic["self"] = cyclic;
    const hostile = {
      get other(): never {
        throw new Error("read");
      },
    };
    const entries = [
      rawEntry("cycle", { ...FIXTURES[1]!.record, payload: cyclic }),
      rawEntry("hostile", { ...FIXTURES[1]!.record, payload: hostile }),
      FIXTURES[1]!,
    ];

    const exported = exportJsonl(entries, REDACT);

    expect(exported.recordCount).toBe(1);
    expect(exported.skipped).toEqual({ unparsed: 0, gap: 0, invalid: 2 });
    expect(exported.text).not.toContain("SECRET");
  });

  it("redacts what a nested toJSON returns", () => {
    const info = { toJSON: () => ({ idTag: "SECRET", kept: "visible" }) };
    const entry = rawEntry("to-json", { ...FIXTURES[1]!.record, payload: { info } });

    const exported = exportJsonl([entry], REDACT);

    expect(exported.recordCount).toBe(1);
    expect(exported.text).not.toContain("SECRET");
    expect(parsedLines(exported.text)[0]!["payload"]).toEqual({
      info: { idTag: "[redacted]", kept: "visible" },
    });
  });

  it("writes what it checked when a getter returns another value on a second read", () => {
    let reads = 0;
    const payload = {
      get info(): Record<string, unknown> {
        reads += 1;
        return reads === 1 ? { kept: "visible" } : { idTag: "SECRET" };
      },
    };
    const entry = rawEntry("unstable", { ...FIXTURES[1]!.record, payload });

    const exported = exportJsonl([entry], REDACT);

    expect(exported.recordCount).toBe(1);
    expect(exported.text).not.toContain("SECRET");
    expect(parsedLines(exported.text)[0]!["payload"]).toEqual({ info: { kept: "visible" } });
  });

  it("skips a record whose meta is null, as the faithful export does", () => {
    const entry = rawEntry("null-meta", { ...FIXTURES[1]!.record, meta: null });

    expect(exportJsonl([entry]).skipped.invalid).toBe(1);
    expect(exportJsonl([entry], REDACT)).toEqual({
      text: "",
      recordCount: 0,
      skipped: { unparsed: 0, gap: 0, invalid: 1 },
    });
  });
});
