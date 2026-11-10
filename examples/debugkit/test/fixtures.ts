import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The vendored specification fixture the example loads. */
export const SPEC_FIXTURE = "failed-auth";

export function readSpecFixture(): string {
  return readFileSync(
    join(
      import.meta.dirname,
      "../../../packages/core/test/fixtures/spec",
      SPEC_FIXTURE,
      "trace.jsonl",
    ),
    "utf8",
  );
}

/** The hand-written edge cases the example appends (not a spec fixture). */
export function readEdgeCases(): string {
  return readFileSync(
    join(import.meta.dirname, "../src/fixtures/hand-written-edge-cases.jsonl"),
    "utf8",
  );
}
