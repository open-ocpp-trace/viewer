import { describe, expect, it } from "vite-plus/test";

import { defaultSensitiveKeys } from "../src/index.ts";
import { type FormatOptions, formatValue, sensitiveKeySet } from "../src/inspect-format.ts";

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
