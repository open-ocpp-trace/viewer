/**
 * The simulator's JSON log lines, for the host's log panel. They are not
 * viewer entries: application, scenario, status and server lines are not
 * frames, and the wire lines are already in the trace as records.
 */

/** A parsed log line; `wire` marks a `Sent:` or `Received:` frame line. */
export interface SimulatorLogLine {
  /** 1-based line number in the file. */
  readonly line: number;
  readonly timestamp: string;
  readonly level: string;
  readonly type: string;
  readonly message: string;
  readonly cpId?: string;
  readonly wire: boolean;
}

export interface SimulatorLogs {
  readonly lines: readonly SimulatorLogLine[];
  /** Numbers of the lines that are not JSON log objects. */
  readonly invalid: readonly number[];
}

const WIRE = /^(?:Sent|Received): /;

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readSimulatorLogs(source: string): SimulatorLogs {
  const lines: SimulatorLogLine[] = [];
  const invalid: number[] = [];
  source.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      invalid.push(index + 1);
      return;
    }
    const fields =
      typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    const message = text(fields["message"]);
    const timestamp = text(fields["timestamp"]);
    if (message === undefined || timestamp === undefined) {
      invalid.push(index + 1);
      return;
    }
    const cpId = text(fields["cpId"]);
    lines.push({
      line: index + 1,
      timestamp,
      level: text(fields["level"]) ?? "",
      type: text(fields["type"]) ?? "",
      message,
      ...(cpId !== undefined && { cpId }),
      wire: WIRE.test(message),
    });
  });
  return { lines, invalid };
}
