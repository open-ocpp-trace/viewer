/**
 * Reads the gateway's event stream with `fetch` and reconnects with an
 * exponential backoff, as the gateway's own viewer does. It stops for good
 * on 401: the page never handles credentials, the browser (Basic prompt) or
 * a reverse proxy does.
 */
import { createSseParser, type SseEvent } from "./sse-parser.ts";

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;
/** A connection open at least this long resets the backoff. */
export const STABLE_CONNECTION_MS = 10_000;
/** The longest `Retry-After` honoured, so a bad header cannot stall the page. */
export const RETRY_AFTER_MAX_MS = 5 * 60_000;

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "auth-failed";

export interface SseTransportOptions {
  readonly url: string;
  /** Sent with the request; `same-origin` by default. */
  readonly credentials?: RequestCredentials;
  /** Extra request headers, such as one a reverse proxy expects. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
  readonly onEvent: (event: SseEvent) => void;
  /** Each state change; `retryInMs` with `reconnecting`. */
  readonly onState?: (state: ConnectionState, retryInMs?: number) => void;
  /** An open stream ended or failed, at `Date.now()`. */
  readonly onLost?: (at: number) => void;
  /** Errors thrown by `onEvent`; the stream keeps going. Default `console.error`. */
  readonly onError?: (error: unknown) => void;
}

export interface SseTransport {
  start(): void;
  stop(): void;
}

/** A `Retry-After` value in milliseconds: delay seconds or an HTTP date. */
function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after")?.trim();
  if (value === undefined || value === "") return undefined;
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.min(Math.max(ms, 0), RETRY_AFTER_MAX_MS);
}

export function createSseTransport(options: SseTransportOptions): SseTransport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  let running = false;
  let attempt = 0;
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function setState(state: ConnectionState, retryInMs?: number): void {
    options.onState?.(state, retryInMs);
  }

  function retry(delayMs?: number): void {
    const delay = delayMs ?? Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
    attempt += 1;
    setState("reconnecting", delay);
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, delay);
  }

  async function read(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const parser = createSseParser();
    // A body that does not follow the fetch signal still ends on stop.
    signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) return;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          if (signal.aborted) return;
          try {
            options.onEvent(event);
          } catch (error) {
            onError(error);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async function connect(): Promise<void> {
    const current = new AbortController();
    controller = current;
    const { signal } = current;
    let response: Response;
    try {
      response = await doFetch(options.url, {
        credentials: options.credentials ?? "same-origin",
        cache: "no-store",
        headers: { accept: "text/event-stream", ...options.headers },
        signal,
      });
    } catch {
      if (!signal.aborted) retry();
      return;
    }
    if (signal.aborted) return;
    if (response.status === 401) {
      running = false;
      void response.body?.cancel();
      setState("auth-failed");
      return;
    }
    if (!response.ok || response.body === null) {
      void response.body?.cancel();
      retry(response.status === 429 || response.status === 503 ? retryAfter(response) : undefined);
      return;
    }
    setState("connected");
    const connectedAt = Date.now();
    try {
      await read(response.body, signal);
    } catch {
      // A network error ends the stream like a close does.
    }
    if (signal.aborted) return;
    const at = Date.now();
    if (at - connectedAt >= STABLE_CONNECTION_MS) attempt = 0;
    options.onLost?.(at);
    retry();
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      setState("connecting");
      void connect();
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      controller?.abort();
      setState("disconnected");
    },
  };
}
