import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { SseEvent } from "../src/sse-parser.ts";
import {
  BACKOFF_MAX_MS,
  type ConnectionState,
  createSseTransport,
  type SseTransport,
  STABLE_CONNECTION_MS,
} from "../src/transport.ts";

/** A response body the test writes to and ends at will. */
interface Body {
  readonly stream: ReadableStream<Uint8Array>;
  write(bytes: Uint8Array | string): void;
  end(): void;
  fail(): void;
}

function body(): Body {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    stream,
    write: (bytes) =>
      controller.enqueue(typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes),
    end: () => controller.close(),
    fail: () => controller.error(new TypeError("network error")),
  };
}

type Reply = Response | Error;

interface Harness {
  transport: SseTransport;
  fetch: ReturnType<typeof vi.fn>;
  events: SseEvent[];
  states: [ConnectionState, number | undefined][];
  lost: number[];
}

function harness(replies: Reply[], options: { headers?: Record<string, string> } = {}): Harness {
  const events: SseEvent[] = [];
  const states: [ConnectionState, number | undefined][] = [];
  const lost: number[] = [];
  const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const reply = replies.shift() ?? new Error("no more replies");
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  });
  const transport = createSseTransport({
    url: "https://gateway.test/viewer/events",
    credentials: "same-origin",
    ...(options.headers !== undefined && { headers: options.headers }),
    fetch,
    onEvent: (event) => events.push(event),
    onState: (state, retryInMs) => states.push([state, retryInMs]),
    onLost: (at) => lost.push(at),
  });
  return { transport, fetch, events, states, lost };
}

function ok(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function retries(states: Harness["states"]): (number | undefined)[] {
  return states.filter(([state]) => state === "reconnecting").map(([, ms]) => ms);
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SSE transport", () => {
  it("requests the event stream and decodes events split anywhere, UTF-8 included", async () => {
    const stream = body();
    const { transport, fetch, events, states } = harness([ok(stream.stream)], {
      headers: { "x-proxy": "1" },
    });
    transport.start();
    await vi.advanceTimersByTimeAsync(0);

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gateway.test/viewer/events");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toEqual({ accept: "text/event-stream", "x-proxy": "1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(states).toEqual([
      ["connecting", undefined],
      ["connected", undefined],
    ]);

    const bytes = new TextEncoder().encode('event: trace\ndata: {"x":"é€"}\n\n');
    for (const byte of bytes) stream.write(new Uint8Array([byte]));
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ event: "trace", data: '{"x":"é€"}' }]);
    transport.stop();
  });

  it("backs off exponentially up to the cap while the gateway is unreachable", async () => {
    const { transport, fetch, states } = harness(
      Array.from({ length: 8 }, () => new TypeError("fetch failed")),
    );
    transport.start();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(retries(states)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
    expect(fetch).toHaveBeenCalledTimes(8);
    transport.stop();
  });

  it("starts again from the first delay after a stable connection", async () => {
    const first = body();
    const second = body();
    const third = body();
    const { transport, states, lost } = harness([
      new TypeError("fetch failed"),
      ok(first.stream),
      ok(second.stream),
      ok(third.stream),
    ]);
    transport.start();
    await vi.advanceTimersByTimeAsync(1000);
    // Connected at 1000, lost after less than the stable time.
    await vi.advanceTimersByTimeAsync(500);
    first.end();
    await vi.advanceTimersByTimeAsync(2000);
    // Connected at 3500, lost after the stable time.
    await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS);
    second.fail();
    await vi.advanceTimersByTimeAsync(0);

    expect(retries(states)).toEqual([1000, 2000, 1000]);
    expect(lost).toEqual([1500, 3500 + STABLE_CONNECTION_MS]);
    transport.stop();
  });

  it("waits for Retry-After on 429 and 503", async () => {
    const { transport, states } = harness([
      new Response(null, { status: 429, headers: { "retry-after": "7" } }),
      new Response(null, { status: 503, headers: { "retry-after": "3" } }),
      new Response(null, { status: 500 }),
    ]);
    transport.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(retries(states)).toEqual([7000, 3000, 4000]);
    transport.stop();
  });

  it("stops for good on 401, leaving authentication to the browser", async () => {
    const { transport, fetch, states } = harness([new Response(null, { status: 401 })]);
    transport.start();
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS * 4);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual(["auth-failed", undefined]);
  });

  it("aborts the stream on stop, without reporting a loss or retrying", async () => {
    const stream = body();
    const { transport, fetch, states, lost } = harness([ok(stream.stream)]);
    transport.start();
    await vi.advanceTimersByTimeAsync(0);
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    transport.stop();
    await vi.advanceTimersByTimeAsync(BACKOFF_MAX_MS);

    expect(init.signal?.aborted).toBe(true);
    expect(lost).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual(["disconnected", undefined]);
  });

  it("keeps reading when the event handler throws", async () => {
    const stream = body();
    const seen: string[] = [];
    const errors: unknown[] = [];
    const transport = createSseTransport({
      url: "https://gateway.test/events",
      fetch: () => Promise.resolve(ok(stream.stream)),
      onEvent: (event) => {
        seen.push(event.event);
        if (event.event === "bad") throw new Error("handler failed");
      },
      onError: (error) => errors.push(error),
    });
    transport.start();
    await vi.advanceTimersByTimeAsync(0);
    stream.write("event: bad\ndata: 1\n\nevent: good\ndata: 2\n\n");
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toEqual(["bad", "good"]);
    expect(errors).toHaveLength(1);
    transport.stop();
  });
});
