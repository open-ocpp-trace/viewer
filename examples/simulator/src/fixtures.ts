// The captured simulator output, bundled as text (see fixtures/HOW.md).
import logsText from "../fixtures/simulator-logs.jsonl?raw";
import traceText from "../fixtures/simulator-trace.jsonl?raw";

/** TraceWriter's JSONL output for the capture: 60 records, unmodified. */
export const SIMULATOR_TRACE: string = traceText;

/** The simulator's JSON log lines for the same run: 160 lines. */
export const SIMULATOR_LOGS: string = logsText;
