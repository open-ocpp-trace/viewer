import { describe, expect, it } from "vite-plus/test";

import { defaultSensitiveKeys } from "../src/index.ts";
import {
  type FormatOptions,
  formatValue,
  holdsSensitiveKey,
  redactValue,
  sensitiveKeyMatcher,
  sensitiveKeySet,
} from "../src/inspect-format.ts";

const OPEN: FormatOptions = { maxChars: 100_000, maxDepth: 64, sensitiveKeys: null };

function print(value: unknown, options: Partial<FormatOptions> = {}): string {
  return formatValue(value, { ...OPEN, ...options }).text;
}

/** Nests `depth` single-key objects with a loop: a recursive builder would overflow too. */
function deepObject(depth: number): unknown {
  let value: unknown = "leaf";
  for (let i = 0; i < depth; i++) value = { a: value };
  return value;
}

describe("formatValue", () => {
  it("pretty prints nested objects and arrays with two spaces", () => {
    expect(print({ a: 1, b: [true, null, { c: "x" }], d: {}, e: [] })).toBe(
      [
        "{",
        '  "a": 1,',
        '  "b": [',
        "    true,",
        "    null,",
        "    {",
        '      "c": "x"',
        "    }",
        "  ],",
        '  "d": {},',
        '  "e": []',
        "}",
      ].join("\n"),
    );
  });

  it("escapes strings and keys like JSON", () => {
    expect(print({ 'k"\n': 'a"b\\c\n\u0001' })).toBe('{\n  "k\\"\\n": "a\\"b\\\\c\\n\\u0001"\n}');
  });

  it("returns an untruncated result when the text fits", () => {
    expect(formatValue([1], OPEN)).toEqual({
      text: "[\n  1\n]",
      truncated: false,
      elided: false,
      unreadable: false,
      redactedCount: 0,
    });
  });

  it("stops at maxChars on a 10 MB string", () => {
    const result = formatValue("x".repeat(10 * 1024 * 1024), { ...OPEN, maxChars: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1000);
    expect(result.text.startsWith('"xxx')).toBe(true);
  });

  it("stops at maxChars on a string that only grows once escaped", () => {
    const result = formatValue("\n".repeat(600), { ...OPEN, maxChars: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(1000);
  });

  it("stops at maxChars on a 1 000 000-element array", () => {
    const result = formatValue(
      Array.from({ length: 1_000_000 }, () => 7),
      { ...OPEN, maxChars: 500 },
    );
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(500);
    expect(result.text.startsWith("[\n  7,\n  7,")).toBe(true);
  });

  it("stops at maxChars on a 1 000 000-key object", () => {
    const value: Record<string, number> = {};
    for (let i = 0; i < 1_000_000; i++) value[`k${i}`] = i;
    const result = formatValue(value, { ...OPEN, maxChars: 500 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(500);
  });

  it("prints a 100 000-deep value without throwing, elided at maxDepth", () => {
    const result = formatValue(deepObject(100_000), { ...OPEN, maxDepth: 3 });
    expect(result.text).toBe('{\n  "a": {\n    "a": {\n      "a": {…}\n    }\n  }\n}');
    expect(result.elided).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it("elides arrays at maxDepth", () => {
    const result = formatValue([[[1]]], { ...OPEN, maxDepth: 1 });
    expect(result.text).toBe("[\n  […]\n]");
    expect(result.elided).toBe(true);
  });

  it("prints a 100 000-deep value with the default depth without throwing", () => {
    const result = formatValue(deepObject(100_000), { ...OPEN, maxChars: 1_000_000 });
    expect(result.elided).toBe(true);
    expect(result.text).toContain("{…}");
  });

  it("marks cycles and prints shared references twice", () => {
    const shared = { s: 1 };
    const value: Record<string, unknown> = { x: shared, y: shared };
    value["self"] = value;
    expect(print(value)).toBe(
      '{\n  "x": {\n    "s": 1\n  },\n  "y": {\n    "s": 1\n  },\n  "self": [Circular]\n}',
    );
  });

  it("prints markers for values JSON cannot hold", () => {
    expect(
      print([undefined, () => 1, Symbol("s"), 12n, Number.NaN, Number.POSITIVE_INFINITY]),
    ).toBe("[\n  undefined,\n  [Function],\n  [Symbol],\n  12n,\n  NaN,\n  Infinity\n]");
  });

  it("prints the markers it is given", () => {
    const markers = {
      redacted: "[masqué]",
      circular: "[circulaire]",
      unreadable: "[illisible]",
      symbol: "[symbole]",
      function: "[fonction]",
      elidedObject: "{…objet}",
      elidedArray: "[…tableau]",
    };
    const value: Record<string, unknown> = {
      idTag: "SECRET",
      f: () => 1,
      s: Symbol("s"),
      deep: { o: {}, a: [1] },
      get bad(): never {
        throw new Error("boom");
      },
    };
    value["self"] = value;
    const text = print(value, { markers, maxDepth: 2, sensitiveKeys: sensitiveKeySet(["idTag"]) });
    expect(text).toBe(
      [
        "{",
        '  "idTag": "[masqué]",',
        '  "f": [fonction],',
        '  "s": [symbole],',
        '  "deep": {',
        '    "o": {…objet},',
        '    "a": […tableau]',
        "  },",
        '  "bad": [illisible],',
        '  "self": [circulaire]',
        "}",
      ].join("\n"),
    );
  });

  it("prints a throwing getter as unreadable", () => {
    const value = {
      ok: 1,
      get bad(): never {
        throw new Error("boom");
      },
    };
    expect(print(value)).toBe('{\n  "ok": 1,\n  "bad": [Unreadable]\n}');
    expect(formatValue(value, OPEN).unreadable).toBe(true);
  });

  it("prints a proxy whose traps throw as unreadable", () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys");
        },
      },
    );
    const revocable = Proxy.revocable([], {});
    revocable.revoke();
    expect(print([hostile, revocable.proxy])).toBe("[\n  [Unreadable],\n  [Unreadable]\n]");
    expect(formatValue([hostile], OPEN).unreadable).toBe(true);
  });

  it("redacts sensitive keys case-insensitively at any depth", () => {
    const result = formatValue(
      { IDTAG: "A", nested: [{ idTag: "B", other: "C" }], parentIdTag: { deep: "D" } },
      { ...OPEN, sensitiveKeys: sensitiveKeySet(defaultSensitiveKeys) },
    );
    expect(result.redactedCount).toBe(3);
    expect(result.text).not.toMatch(/"[ABD]"/);
    expect(result.text).toContain('"other": "C"');
    expect(result.text).toContain('"IDTAG": "[redacted]"');
  });

  it("does not read the value of a redacted key", () => {
    const value = {
      get password(): never {
        throw new Error("read");
      },
    };
    const result = formatValue(value, { ...OPEN, sensitiveKeys: sensitiveKeySet(["password"]) });
    expect(result.text).toBe('{\n  "password": "[redacted]"\n}');
  });

  it("redacts nothing when sensitiveKeys is null", () => {
    const result = formatValue({ idTag: "A" }, OPEN);
    expect(result.redactedCount).toBe(0);
    expect(result.text).toContain('"idTag": "A"');
  });

  it("prints a full text without a char limit", () => {
    const text = print("y".repeat(50_000), { maxChars: Number.POSITIVE_INFINITY });
    expect(text.length).toBe(50_002);
  });
});

describe("defaultSensitiveKeys", () => {
  it("lists the OCPP authorization fields", () => {
    expect(defaultSensitiveKeys).toEqual([
      "idTag",
      "parentIdTag",
      "idToken",
      "groupIdToken",
      "authorizationKey",
      "password",
      "basicAuthPassword",
    ]);
  });
});

describe("redactValue", () => {
  const matcher = sensitiveKeyMatcher(sensitiveKeySet(defaultSensitiveKeys));

  it("replaces sensitive values case-insensitively at any depth, arrays walked", () => {
    const value = {
      IDTAG: "A",
      nested: [{ idTag: "B", other: "C" }, [{ password: { deep: "D" } }]],
      keep: { x: 1 },
    };
    expect(redactValue(value, matcher)).toEqual({
      IDTAG: "[redacted]",
      nested: [{ idTag: "[redacted]", other: "C" }, [{ password: "[redacted]" }]],
      keep: { x: 1 },
    });
  });

  it("returns the same references where nothing is redacted", () => {
    const keep = { x: [1, 2] };
    const value = { keep, list: [keep], hit: { idTag: "A" } };
    const redacted = redactValue(value, matcher) as typeof value;
    expect(redacted).not.toBe(value);
    expect(redacted.keep).toBe(keep);
    expect(redacted.list).toBe(value.list);
    expect(redactValue(keep, matcher)).toBe(keep);
    expect(redactValue("idTag", matcher)).toBe("idTag");
  });

  it("never mutates its input", () => {
    const value = Object.freeze({ a: Object.freeze([Object.freeze({ idTag: "A" })]) });
    expect(redactValue(value, matcher)).toEqual({ a: [{ idTag: "[redacted]" }] });
    expect(value.a[0]!.idTag).toBe("A");
  });

  it("does not read the value of a redacted key", () => {
    const value = {
      get password(): never {
        throw new Error("read");
      },
    };
    expect(redactValue(value, matcher)).toEqual({ password: "[redacted]" });
  });

  it("keeps a __proto__ key as an own property", () => {
    const value = JSON.parse('{"__proto__":{"idTag":"A"},"b":1}') as unknown;
    const redacted = redactValue(value, matcher);
    expect(JSON.stringify(redacted)).toBe('{"__proto__":{"idTag":"[redacted]"},"b":1}');
    expect(Object.getPrototypeOf(redacted)).toBe(Object.prototype);
  });

  it("walks 100 000 levels without throwing", () => {
    let value: unknown = { idTag: "A" };
    for (let i = 0; i < 100_000; i++) value = { a: value };
    let redacted = redactValue(value, matcher) as { a?: unknown; idTag?: unknown };
    while (redacted.a !== undefined) redacted = redacted.a as typeof redacted;
    expect(redacted).toEqual({ idTag: "[redacted]" });
    expect(() => redactValue(deepObject(100_000), matcher)).not.toThrow();
  });

  it("leaves a cycle in place rather than looping", () => {
    const value: Record<string, unknown> = { idTag: "A" };
    value["self"] = value;
    const redacted = redactValue(value, matcher) as Record<string, unknown>;
    expect(redacted["idTag"]).toBe("[redacted]");
    expect(redacted["self"]).toBe(value);
  });

  it("redacts nothing with an empty key list", () => {
    const value = { idTag: "A" };
    expect(redactValue(value, sensitiveKeyMatcher(sensitiveKeySet([])))).toBe(value);
  });
});

describe("holdsSensitiveKey", () => {
  const matcher = sensitiveKeyMatcher(sensitiveKeySet(defaultSensitiveKeys));

  it("finds a sensitive key at any depth, in arrays, case-insensitively", () => {
    expect(holdsSensitiveKey([2, "m", "Authorize", { IdTag: "A" }], matcher)).toBe(true);
    expect(holdsSensitiveKey({ a: [[{ b: { parentidtag: 1 } }]] }, matcher)).toBe(true);
    expect(holdsSensitiveKey([2, "m", "Heartbeat", { idTagX: "A" }], matcher)).toBe(false);
    expect(holdsSensitiveKey("idTag", matcher)).toBe(false);
    expect(holdsSensitiveKey(deepObject(100_000), matcher)).toBe(false);
  });
});
