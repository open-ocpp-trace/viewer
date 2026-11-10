// A stand-in for the OCPP Gateway's viewer server: serves the built page and
// a scripted `events` stream, with the gateway's security headers and,
// optionally, its Basic authentication.
//
//   node --experimental-strip-types mock/server.ts [--port 9001]
//     [--host 127.0.0.1] [--base /] [--delay 400] [--live 5000]
//
// MOCK_USER and MOCK_PASSWORD (environment, never arguments) turn Basic
// authentication on for every route, as VIEWER_USERNAME/PASSWORD do on the
// gateway. `--base /ops/gateway/` serves everything under that path, as a
// reverse proxy would.
//
// The stream plays fixtures/connection-1.json, ends it (a forced
// disconnect), plays connection-2.json on the reconnection, ends it again,
// then plays connection-3.json, whose hello carries a new startedAt (a
// restart), and keeps that connection open with live heartbeats. A client
// that connects outside that reconnection window starts over.

import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", default: "9001" },
    host: { type: "string", default: "127.0.0.1" },
    base: { type: "string", default: "/" },
    delay: { type: "string", default: "400" },
    live: { type: "string", default: "5000" },
  },
});

const PORT = Number(args.port);
const BASE = `/${args.base.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
const DELAY_MS = Number(args.delay);
const LIVE_MS = Number(args.live);
const PING_MS = 15_000;
/** How long after a scripted disconnect a new connection continues the script. */
const RECONNECT_WINDOW_MS = 10_000;

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const FIXTURES = new URL("../fixtures/", import.meta.url);

interface FixtureEvent {
  readonly event: string;
  readonly data: unknown;
}

const CONNECTIONS: readonly (readonly FixtureEvent[])[] = [1, 2, 3].map(
  (n) =>
    JSON.parse(readFileSync(new URL(`connection-${n}.json`, FIXTURES), "utf8")) as FixtureEvent[],
);

// The gateway's headers (src/viewer/server.ts), on every response.
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
    "img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const user = process.env["MOCK_USER"];
const password = process.env["MOCK_PASSWORD"];
const expectedAuth =
  user !== undefined && password !== undefined
    ? Buffer.from(`Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`)
    : undefined;

function authorized(request: IncomingMessage): boolean {
  if (expectedAuth === undefined) return true;
  const given = Buffer.from(request.headers.authorization ?? "");
  return given.length === expectedAuth.length && timingSafeEqual(given, expectedAuth);
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function serveFile(response: ServerResponse, relative: string, head: boolean): void {
  const file = resolve(DIST, relative === "" ? "index.html" : relative);
  if (!file.startsWith(DIST.endsWith(sep) ? DIST : DIST + sep)) {
    send(response, 404, "Not found");
    return;
  }
  let body: Buffer;
  try {
    body = readFileSync(file);
  } catch {
    const hint = relative === "" ? " (build the page first: vp run …-gateway#build)" : "";
    send(response, 404, `Not found${hint}`);
    return;
  }
  const type = CONTENT_TYPES[extname(file)] ?? "application/octet-stream";
  send(response, 200, head ? "" : body, { "content-type": type });
}

// Script position, shared by every client: the mock plays one scenario.
let nextConnection = 0;
let continueUntil = 0;
let liveCount = 0;

function sse(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function liveEvents(): FixtureEvent[] {
  liveCount += 1;
  const id = `live-${liveCount}`;
  const at = new Date().toISOString();
  const route = [{ target: "csms-a", role: "primary" }];
  const meta = {
    gateway: {
      traceId: id,
      tenantId: "tenant-a",
      sessionId: "session-a2",
      seq: liveCount,
      source: { type: "charge-point", id: "CP-001" },
      destinations: route,
    },
  };
  return [
    {
      event: "trace",
      data: {
        id,
        tenantId: "tenant-a",
        sessionId: "session-a2",
        chargePointId: "CP-001",
        seq: liveCount,
        receivedAt: at,
        deliveries: [{ ...route[0], status: "queued", updatedAt: at }],
        kind: "trace",
        trace: {
          schemaVersion: "1.1",
          timestamp: at,
          ocppVersion: "1.6",
          transport: "json",
          chargePointId: "CP-001",
          direction: "cp-to-csms",
          messageType: "CALL",
          messageId: `hb-${liveCount}`,
          action: "Heartbeat",
          payload: {},
          raw: `[2,"hb-${liveCount}","Heartbeat",{}]`,
          meta,
        },
      },
    },
    {
      event: "delivery",
      data: { id, index: 0, delivery: { ...route[0], status: "written", updatedAt: at } },
    },
  ];
}

function streamEvents(response: ServerResponse): void {
  const index = Date.now() < continueUntil ? nextConnection : 0;
  continueUntil = 0;
  const script = CONNECTIONS[index] ?? [];
  const last = index === CONNECTIONS.length - 1;
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-type": "text/event-stream; charset=utf-8",
    connection: "keep-alive",
  });
  const timers: ReturnType<typeof setTimeout>[] = [];
  response.on("close", () => {
    for (const timer of timers) clearTimeout(timer);
  });
  script.forEach(({ event, data }, i) => {
    timers.push(setTimeout(() => sse(response, event, data), i * DELAY_MS));
  });
  const done = script.length * DELAY_MS;
  if (!last) {
    timers.push(
      setTimeout(() => {
        nextConnection = index + 1;
        continueUntil = Date.now() + RECONNECT_WINDOW_MS;
        response.end();
      }, done),
    );
    return;
  }
  timers.push(
    setInterval(() => response.write(": ping\n\n"), PING_MS),
    setInterval(() => {
      const [trace, delivery] = liveEvents();
      if (trace !== undefined) sse(response, trace.event, trace.data);
      timers.push(
        setTimeout(
          () => delivery !== undefined && sse(response, delivery.event, delivery.data),
          500,
        ),
      );
    }, LIVE_MS),
  );
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://mock.invalid").pathname;
  if (!authorized(request)) {
    send(response, 401, "Unauthorized", {
      "www-authenticate": 'Basic realm="OCPP Gateway viewer (mock)", charset="UTF-8"',
    });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed", { allow: "GET, HEAD" });
    return;
  }
  if (`${path}/` === BASE) {
    // A relative URL resolves against the directory: keep the slash.
    send(response, 301, "", { location: BASE });
    return;
  }
  if (!path.startsWith(BASE)) {
    send(response, 404, "Not found");
    return;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(path.slice(BASE.length));
  } catch {
    send(response, 400, "Bad request");
    return;
  }
  if (relative === "events") {
    if (request.method === "HEAD") {
      send(response, 200, "", { "content-type": "text/event-stream; charset=utf-8" });
      return;
    }
    streamEvents(response);
    return;
  }
  serveFile(response, relative, request.method === "HEAD");
});

server.listen(PORT, args.host, () => {
  const auth = expectedAuth === undefined ? "no authentication" : "Basic authentication";
  console.log(`Mock gateway viewer on http://${args.host}:${PORT}${BASE} (${auth})`);
});
