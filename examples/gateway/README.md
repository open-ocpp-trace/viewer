# Gateway example

A plain HTML and TypeScript page that feeds the built
`@open-ocpp-trace/viewer-standalone` asset from the
[OCPP Gateway](https://github.com/juherr/ocpp-gateway)'s viewer events
(server-sent events), keeping the gateway's tenant, session, source, delivery
and stream semantics. The page has no React. It does not replace the gateway's
own viewer.

The gateway adapter lives here, not in `packages/`: the viewer packages know
neither the gateway's wire format nor any `/events` URL. Gateway types are
not imported either. `src/wire.ts` declares the few fields the adapter reads.

## Layout

| File                | Role                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/wire.ts`       | Minimal wire types and a decoder that checks each event's shape. Events are untrusted.                                          |
| `src/mapping.ts`    | Maps a trace document to a viewer entry. Pure.                                                                                  |
| `src/feed.ts`       | The adapter's state: delivery ranks, gaps, counters, and the `ViewerAdapter` the viewer connects to. Free of DOM and transport. |
| `src/sse-parser.ts` | Incremental `text/event-stream` parser.                                                                                         |
| `src/transport.ts`  | `fetch` reader with backoff. It stops on 401.                                                                                   |
| `src/config.ts`     | Resolves the events URL, credentials and headers.                                                                               |
| `src/counters.ts`   | Writes the adapter's counters and the viewer store's `getStats()` to the page.                                                  |
| `src/main.ts`       | The page glue: status line, counters, `mount()`, export download.                                                               |
| `fixtures/`         | Three gateway connections, as the SSE events the gateway sends.                                                                 |
| `mock/server.ts`    | A mock of the gateway's viewer server.                                                                                          |
| `test/`             | Tests, run by `vp test`: projects `gateway` (Node.js) and `gateway-dom` (happy-dom, `*.dom.test.ts`).                           |

## Run it

From the repository root, after `bun install`:

```sh
vp run -r pack                                          # builds packages/standalone/dist
vp run @open-ocpp-trace/viewer-example-gateway#build    # builds examples/gateway/dist
```

The page imports the packed `packages/standalone/dist/index.js`, never the
package sources, as in `examples/standalone`. Pack the packages again after
you change them.

### Mock mode

```sh
cd examples/gateway
node --experimental-strip-types mock/server.ts          # http://127.0.0.1:9001/
```

The mock serves the built page and `events` with the gateway's exact security
headers: the CSP `default-src 'none'; script-src 'self'; style-src 'self';
connect-src 'self'; …`, `X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy: no-referrer` and `Cache-Control: no-store`. The page runs
under that CSP without a violation. Viewer styles go through constructable
stylesheets, and the page never sets inline styles.

The stream plays a scripted scenario:

1. `fixtures/connection-1.json`: a `hello`, then CALL, CALLRESULT and
   CALLERROR records across two charge points and two tenants, all with
   message id `1`. Then the answer of a secondary CSMS, which the gateway
   ignores, an unparsed `frame`, and delivery updates. One update arrives
   out of order with a lower rank, one has an unknown id, one an
   out-of-range index. All three are ignored. The connection ends with a
   `gap` of 3 events the gateway dropped, then the server closes it.
2. `fixtures/connection-2.json`: the reconnection, with the same `startedAt`,
   so the page lists a _disconnected_ gap. It adds an entry without a tenant.
   The server closes the stream again.
3. `fixtures/connection-3.json`: a `hello` with a new `startedAt`, so the
   page lists a _restarted_ gap. A live heartbeat follows every five
   seconds.

A client that connects outside the reconnection window starts over at the
first connection.

Options: `--port 9001`, `--host 127.0.0.1`, `--base /` (serve under a path,
as a reverse proxy would), `--delay 400` (ms between scripted events) and
`--live 5000` (ms between live heartbeats). Set `MOCK_USER` and
`MOCK_PASSWORD` in the environment to require HTTP Basic authentication on
every route, as the gateway does with `VIEWER_USERNAME`/`VIEWER_PASSWORD`.

### Dev mode

```sh
cd examples/gateway
node --experimental-strip-types mock/server.ts &        # or a real gateway
vp dev                                                  # http://localhost:5173/
```

`vp dev` proxies the page's `events` requests to `GATEWAY_URL` (default
`http://127.0.0.1:9001`), so the page reads them from its own origin. When
the gateway requires Basic authentication, set `GATEWAY_AUTH=user:password`.
The proxy sends those credentials and the browser never sees them. The dev
server injects inline styles for hot reload, so the gateway's CSP applies
only to the built page.

### Live gateway

A live gateway viewer server (`VIEWER_ENABLED=true`) can feed the page in
two ways:

- **Same origin, the recommended way.** Serve the built `dist/` and proxy
  `events` to the gateway's viewer port, from one reverse proxy, or with
  `vp dev` and `GATEWAY_URL` as above.
- **Another URL.** Pass `?events=https://gateway.example:9001/events`, or
  set `data-events-url` on `<main id="gateway">`. The page resolves the URL;
  the browser then applies the usual cross-origin rules. The gateway sends no
  CORS headers, and the CSP of a page it serves allows `connect-src 'self'`
  only. A cross-origin stream therefore works only from a page and a proxy
  you control.

## Configuration

| Setting     | Query string  | Attribute on `<main id="gateway">` | Default       |
| ----------- | ------------- | ---------------------------------- | ------------- |
| Events URL  | `events`      | `data-events-url`                  | `events`      |
| Credentials | `credentials` | `data-credentials`                 | `same-origin` |
| Headers     | (none)        | `data-headers` (a JSON object)     | none          |

The query string wins over the attribute. The events URL resolves against
the page's base URI, so the default `events` follows the page behind a
reverse proxy: a page served at `https://proxy/ops/gateway/` reads
`https://proxy/ops/gateway/events`. Keep the trailing slash. At
`https://proxy/ops/gateway` (no slash), `events` resolves to
`https://proxy/events`. The mock redirects the slash-less path, as a proxy
should. The build uses relative asset URLs (`base: "./"`) for the same
reason. Only `http:` and `https:` URLs are accepted.

Headers come from the attribute only, never from the query string, so a
link cannot make the page send them.

## Authentication

The page never asks for, stores or sends gateway credentials. With
`same-origin`, the browser sends the Basic credentials it was given when it
loaded the page from the gateway or the proxy. A reverse proxy can also
authenticate the user. On a 401 the transport stops for good and shows
_Authentication failed_: reload the page to sign in again. Other failures
reconnect with an exponential backoff, from 1 s up to 30 s. A connection
open for 10 s resets the backoff, and the page honours `Retry-After` on 429
and 503.

## What the page shows

- A connection status: connecting, connected, reconnecting (with the delay),
  disconnected or auth-failed.
- The adapter's counters: documents received, delivery updates applied and
  ignored, events the gateway dropped for this client, per-entry delivery
  states the adapter evicted (`deliveryStatesEvicted`, its own bound, not
  the viewer's rows), and undecodable events.
- The viewer store's counters, from `ViewerInstance.getStats()`: entries
  listed, entries pending while paused, listed rows the bounds evicted,
  pending entries dropped while paused (`droppedPending`), updates for an
  unknown id or a stale revision, and invalid batch items. The page renders
  both groups on the next animation frame after the adapter's events, and
  after a click in the viewer (Pause, Resume, Clear); it does not poll.
- Stream text reaches the page through `textContent` only.
- The viewer. Each `kind: "trace"` document becomes a trace entry, and
  `record` is the document's record itself, neither copied nor changed. The
  metadata holds:
  - `tenant` (left out when `tenantId` is `null`), `chargePointId` and
    `sessionId`;
  - `conversationId`, the session: one charge point connection, the scope of
    OCPP message ids;
  - `source` as `charge-point:<id>` or `csms:<id>`, with a label;
  - `deliveries`;
  - in `custom`: `seq`, the gateway's `correlation`, and the `ignored` and
    `binary` flags.

  A `kind: "frame"` document becomes an unparsed entry with its raw frame and
  reason. It is never turned into a record. The built-in filters for tenant,
  charge point, session, direction, source (`sourceIds`) and delivery status
  all work on this metadata.

### Delivery updates

A `delivery` event `{id, index, delivery}` updates the delivery at `index`
of an entry already shown, in place: the row is never added twice. The
target and role stay the ones the document announced. The adapter keeps the
gateway's ranks: `queued`, then `submitted`, then a final status (`written`,
`failed` or `dropped`). It ignores and counts:

- an update whose rank is not higher than the current one;
- an unknown status;
- an unknown id;
- an index out of range.

The adapter keeps these per-entry states in insertion order and evicts the
oldest past twice the gateway's `maxBufferedMessages`. That is how many
entries a paused viewer holds: its listed entries plus as many pending ones.
With the same bound as the viewer's list, a burst received while paused
would evict the state of entries the viewer still lists, and their updates
would be lost.

### Gaps

- `gap {dropped}` lists a gap with reason `dropped` and `missedCount`.
- A lost stream lists a gap when the next `hello` arrives, dated at the
  loss. Its reason is `disconnected`, or `restarted` when the hello carries
  a new `startedAt`. A restarted gap keeps both `startedAt` values in
  `metadata.custom`.

The gateway keeps no history, so events sent while the page was
disconnected are lost. The gap marks where.

### Capacity

The page mounts the viewer on the first `hello`, with
`maxEntries = hello.maxBufferedMessages`, so it keeps as many entries as the
gateway buffers. A store's bounds are fixed when it is created. If the
gateway restarts with another buffer size, the page keeps the first one,
says so in a notice, and applies the new size only after a reload. The
viewer's byte limit (64 MiB by default) still applies.

## Export

The viewer's export buttons write JSONL with the SDK writer, from trace
entries only. Records are written exactly as the gateway sent them, with
`meta.gateway`. Unparsed frames and gaps are counted as skipped and never
written as conformant records. The viewer's metadata (deliveries, tenant,
source) is not exported either. The page downloads the file and states what
was left out. `test/viewer.test.ts` checks this on the fixture scenario.

## Tests

```sh
vp test --project gateway --project gateway-dom
```

The tests cover:

- the mapping of trace and frame documents;
- a delivery update that changes the existing row, against a real
  `createViewerStore`;
- stale, unknown-id and out-of-range updates;
- the bound on per-entry states under bursts and while paused;
- bounded memory end to end, against a mounted viewer-standalone: a burst
  past `maxBufferedMessages` shows the viewer's evictions with the adapter's
  state at its capacity, and a burst while paused shows the pending and
  dropped entries (`test/page.dom.test.ts`);
- gaps for dropped events, disconnects and restarts;
- pause and resume with a burst of updates;
- SSE parsing for every chunk boundary;
- the transport's backoff, `Retry-After` and stop on 401, with a fake
  `fetch`;
- the host configuration;
- filters on the adapter metadata;
- an export that leaves frames and gaps out.
