import { readRecords } from "@open-ocpp-trace/jsonl";
import type { ViewerEntry } from "@open-ocpp-trace/viewer-core";

/**
 * Reads a JSONL trace with the released SDK reader into viewer entries, in
 * line order. A readable line becomes a trace entry `<source>:<line>`; a line
 * the reader rejects becomes an unparsed entry under the same id, holding the
 * line as written and the reader's reason. Blank lines are skipped.
 */
export async function readFixtureEntries(source: string, text: string): Promise<ViewerEntry[]> {
  const lines = text.split(/\r?\n/);
  const entries: ViewerEntry[] = [];
  for await (const result of readRecords([text], { onError: "yield" })) {
    if (result.ok) {
      entries.push({ kind: "trace", id: `${source}:${result.line}`, record: result.record });
    } else {
      const { line, message } = result.error;
      entries.push({
        kind: "unparsed",
        id: `${source}:${line}`,
        raw: lines[line - 1] ?? "",
        reason: message,
      });
    }
  }
  return entries;
}
