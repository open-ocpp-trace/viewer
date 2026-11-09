import { describe, expect, it } from "vite-plus/test";

import { firstError } from "../src/store-listeners.ts";

describe("firstError", () => {
  it("runs every step and rethrows the first error", () => {
    const first = new Error("first");
    const ran: number[] = [];
    const errors = firstError();
    errors.run(() => {
      ran.push(1);
      throw first;
    });
    errors.run(() => {
      ran.push(2);
    });
    errors.run(() => {
      ran.push(3);
      throw new Error("second");
    });
    expect(ran).toEqual([1, 2, 3]);
    expect(errors.failure).toEqual({ error: first });
    expect(() => errors.rethrow()).toThrow(first);
  });

  it("keeps a thrown undefined as a failure", () => {
    const errors = firstError();
    errors.run(() => {
      throw undefined;
    });
    errors.run(() => {
      throw new Error("later");
    });
    expect(errors.failure).toEqual({ error: undefined });
  });

  it("does not throw when no step failed", () => {
    const errors = firstError();
    errors.run(() => undefined);
    expect(errors.failure).toBeUndefined();
    expect(() => errors.rethrow()).not.toThrow();
  });
});
