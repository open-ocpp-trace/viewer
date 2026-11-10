import { parseOpenOcppTrace } from "@ocpp-debugkit/toolkit/core";
import { describe, expect, it } from "vite-plus/test";

import { installBufferShim } from "../src/buffer-shim.ts";
import { readSpecFixture } from "./fixtures.ts";

const scope = globalThis as { Buffer?: unknown };

/** Runs `body` as in a browser, where `Buffer` does not exist. */
function withoutBuffer(body: () => void): void {
  const saved = scope.Buffer;
  delete scope.Buffer;
  try {
    body();
  } finally {
    scope.Buffer = saved;
  }
}

describe("installBufferShim", () => {
  it("lets DebugKit parse where Buffer is undefined", () => {
    withoutBuffer(() => {
      expect(typeof scope.Buffer).toBe("undefined");
      expect(() => parseOpenOcppTrace(readSpecFixture())).toThrow(ReferenceError);

      installBufferShim();

      expect(parseOpenOcppTrace(readSpecFixture()).events).toHaveLength(14);
    });
  });

  it("measures UTF-8 bytes, so the size limit still applies", () => {
    withoutBuffer(() => {
      installBufferShim();

      const shim = scope.Buffer as { byteLength(text: string): number };
      expect(shim.byteLength("é€😀")).toBe(2 + 3 + 4);
    });
  });

  it("leaves an existing Buffer alone", () => {
    const before = scope.Buffer;

    installBufferShim();

    expect(scope.Buffer).toBe(before);
  });
});
