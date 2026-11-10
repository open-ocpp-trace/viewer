/**
 * An incremental parser of the `text/event-stream` format (HTML Living
 * Standard, "Server-sent events"), fed decoded text in chunks of any size.
 * It keeps only the event type and data fields; `id` and `retry` are
 * ignored, as the gateway sends neither.
 */

/** One dispatched event: its type (`"message"` by default) and data. */
export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

export interface SseParser {
  /** Parses one chunk of decoded text and returns the events it completes. */
  push(chunk: string): SseEvent[];
}

/** U+FEFF, skipped once at the start of the stream. */
const BOM = String.fromCharCode(0xfeff);

export function createSseParser(): SseParser {
  let buffer = "";
  let started = false;
  /** The previous chunk ended on CR: a LF opening this one ends no line. */
  let afterCr = false;
  let eventType = "";
  let data = "";
  let hasData = false;

  function line(text: string, events: SseEvent[]): void {
    if (text === "") {
      if (hasData) events.push({ event: eventType === "" ? "message" : eventType, data });
      eventType = "";
      data = "";
      hasData = false;
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") {
      eventType = value;
    } else if (field === "data") {
      data = hasData ? `${data}\n${value}` : value;
      hasData = true;
    }
  }

  return {
    push(chunk) {
      const events: SseEvent[] = [];
      buffer += chunk;
      if (!started && buffer.length > 0) {
        started = true;
        if (buffer.startsWith(BOM)) buffer = buffer.slice(1);
      }
      let start = 0;
      if (afterCr && buffer.startsWith("\n")) start = 1;
      afterCr = false;
      for (let i = start; i < buffer.length; i += 1) {
        const char = buffer[i];
        if (char !== "\n" && char !== "\r") continue;
        line(buffer.slice(start, i), events);
        if (char === "\r") {
          if (i + 1 === buffer.length) afterCr = true;
          else if (buffer[i + 1] === "\n") i += 1;
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
      return events;
    },
  };
}
