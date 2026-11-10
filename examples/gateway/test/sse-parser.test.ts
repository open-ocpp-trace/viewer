import { describe, expect, it } from "vite-plus/test";

import { createSseParser, type SseEvent } from "../src/sse-parser.ts";

const BOM = String.fromCharCode(0xfeff);

const STREAM =
  ': ping\n\nevent: hello\ndata: {"a":1}\n\nevent: trace\r\ndata: {"b":"é"}\r\n\r\n' +
  "data: line 1\ndata: line 2\n\nevent: gap\rdata: {}\r\r";

const EXPECTED: SseEvent[] = [
  { event: "hello", data: '{"a":1}' },
  { event: "trace", data: '{"b":"é"}' },
  { event: "message", data: "line 1\nline 2" },
  { event: "gap", data: "{}" },
];

function parseInChunks(text: string, size: number): SseEvent[] {
  const parser = createSseParser();
  const events: SseEvent[] = [];
  for (let i = 0; i < text.length; i += size) events.push(...parser.push(text.slice(i, i + size)));
  return events;
}

describe("SSE parser", () => {
  it("parses named events, comments, multi-line data and all three line endings", () => {
    expect(createSseParser().push(STREAM)).toEqual(EXPECTED);
  });

  it("gives the same events whatever the chunk boundaries", () => {
    for (let size = 1; size <= STREAM.length; size += 1) {
      expect(parseInChunks(STREAM, size), `chunks of ${size}`).toEqual(EXPECTED);
    }
  });

  it("reads a CRLF split across chunks as one line ending, not two", () => {
    const parser = createSseParser();
    expect(parser.push("data: a\r")).toEqual([]);
    expect(parser.push("\ndata: b\n\n")).toEqual([{ event: "message", data: "a\nb" }]);
  });

  it("skips a leading byte order mark and strips one space after the colon only", () => {
    expect(createSseParser().push(`${BOM}data:  x\n\n`)).toEqual([
      { event: "message", data: " x" },
    ]);
  });

  it("ignores events without data, id and retry fields and unknown fields", () => {
    expect(
      createSseParser().push("event: hello\n\nid: 1\nretry: 10\nfoo: bar\ndata\nevent: x\n\n"),
    ).toEqual([{ event: "x", data: "" }]);
  });

  it("keeps an unterminated event until its blank line arrives", () => {
    const parser = createSseParser();
    expect(parser.push("event: trace\ndata: {}\n")).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "trace", data: "{}" }]);
  });
});
