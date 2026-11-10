import type { TraceRecord } from "@open-ocpp-trace/core";

import csmsFramesText from "../fixtures/csms-frames.jsonl?raw";
import { SIMULATOR_LOGS, SIMULATOR_TRACE } from "../src/fixtures.ts";

/** The non-blank lines of a JSONL text. */
export function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** Fresh parses of the captured records, independent of the adapter. */
export function parsedRecords(): TraceRecord[] {
  return lines(SIMULATOR_TRACE).map((line) => JSON.parse(line) as TraceRecord);
}

/** A frame as the test CSMS logged it: `out` is CSMS to CP. */
export interface CsmsFrame {
  readonly t: string;
  readonly cp: string;
  readonly dir: "in" | "out";
  readonly frame: unknown;
}

export function csmsFrames(): CsmsFrame[] {
  return lines(csmsFramesText).map((line) => JSON.parse(line) as CsmsFrame);
}

export { SIMULATOR_LOGS, SIMULATOR_TRACE };
