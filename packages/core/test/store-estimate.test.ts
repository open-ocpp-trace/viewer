import { describe, expect, it } from "vite-plus/test";

import { coreWeight, estimateBytes, metadataWeight } from "../src/store-estimate.ts";
import { gap, trace, unparsed } from "./store-fixtures.ts";

const LIMIT = 1_000_000;

describe("estimateBytes", () => {
  it("counts strings at about two bytes per character", () => {
    expect(estimateBytes("x".repeat(1000), LIMIT)).toBeGreaterThanOrEqual(2000);
    expect(estimateBytes("x".repeat(1000), LIMIT)).toBeLessThan(2100);
  });

  it("grows with keys and values", () => {
    const small = estimateBytes({ a: 1 }, LIMIT);
    const large = estimateBytes({ a: 1, b: "text", c: [true, null, { d: 2 }] }, LIMIT);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  it("never throws or loops on hostile values", () => {
    const cycle: Record<string, unknown> = { name: "loop" };
    cycle["self"] = cycle;
    const throwing = {
      get boom(): never {
        throw new Error("getter");
      },
    };
    let deep: Record<string, unknown> = {};
    for (let depth = 0; depth < 10_000; depth++) deep = { deep };
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const sparse: unknown[] = [];
    sparse.length = 1e9;
    const hostileKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys");
        },
      },
    );

    for (const value of [
      cycle,
      throwing,
      deep,
      10n ** 40n,
      Symbol("s"),
      () => 1,
      revoked.proxy,
      hostileKeys,
      sparse,
      { length: 1e9 },
      undefined,
      null,
    ]) {
      const bytes = estimateBytes(value, LIMIT);
      expect(Number.isFinite(bytes)).toBe(true);
      expect(bytes).toBeGreaterThan(0);
    }
  });

  it("stops walking once the limit is exceeded", () => {
    const values = Array.from({ length: 100_000 }, (_, index) => `value-${index}`);
    const bytes = estimateBytes(values, 1000);
    expect(bytes).toBeGreaterThan(1000);
    expect(bytes).toBeLessThan(2000);
  });

  it("fails closed when the depth cap cuts the walk short", () => {
    let deep: Record<string, unknown> = { leaf: "x" };
    for (let depth = 0; depth < 40; depth++) deep = { deep };

    expect(estimateBytes(deep, LIMIT)).toBeGreaterThan(LIMIT);
  });

  it("fails closed when the node cap cuts the walk short", () => {
    const wide = Array.from({ length: 150_000 }, () => 0);

    expect(estimateBytes(wide, 10_000_000)).toBeGreaterThan(10_000_000);
  });

  it("fails closed when enumerating the keys of a value throws", () => {
    const hostileKeys = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("ownKeys");
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostileLength = new Proxy([], {
      get(target, key, receiver) {
        if (key === "length") throw new Error("length");
        return Reflect.get(target, key, receiver);
      },
    });

    expect(estimateBytes(hostileKeys, LIMIT)).toBeGreaterThan(LIMIT);
    expect(estimateBytes({ nested: hostileKeys }, LIMIT)).toBeGreaterThan(LIMIT);
    expect(estimateBytes(revoked.proxy, LIMIT)).toBeGreaterThan(LIMIT);
    expect(estimateBytes(hostileLength, LIMIT)).toBeGreaterThan(LIMIT);
  });

  it("counts a shared or cyclic object once without failing closed", () => {
    const shared = { target: "csms", status: "queued" };
    const cycle: Record<string, unknown> = { list: [shared, shared, shared] };
    cycle["self"] = cycle;

    expect(estimateBytes(cycle, LIMIT)).toBeLessThan(1000);
  });
});

describe("entry weights", () => {
  it("weighs the record of a trace, the raw frame and reason of an unparsed entry", () => {
    const big = unparsed("u", "x".repeat(10_000));
    expect(coreWeight(big, LIMIT)).toBeGreaterThan(20_000);
    expect(coreWeight(trace("t"), LIMIT)).toBeGreaterThan(coreWeight(gap("g"), LIMIT));
  });

  it("weighs metadata apart from the core", () => {
    const bare = trace("t");
    const rich = trace("t", { metadata: { tenant: "x".repeat(1000) } });
    expect(metadataWeight(bare, LIMIT)).toBe(0);
    expect(metadataWeight(rich, LIMIT)).toBeGreaterThan(2000);
    expect(coreWeight(rich, LIMIT)).toBe(coreWeight(bare, LIMIT));
  });

  it("weighs the optional fields of each kind", () => {
    const long = "x".repeat(10_000);
    expect(coreWeight({ ...trace("t"), receivedAt: long }, LIMIT)).toBeGreaterThan(20_000);
    expect(coreWeight({ ...unparsed("u"), timestamp: long }, LIMIT)).toBeGreaterThan(20_000);
    expect(coreWeight({ ...gap("g"), reason: long }, LIMIT)).toBeGreaterThan(20_000);
  });
});
