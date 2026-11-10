// The page glue: reads the OCPP Gateway's viewer events and feeds them to
// the built viewer-standalone asset. The page has no React and sets every
// piece of stream text with `textContent`, never as HTML.

import {
  mount,
  type ExportScope,
  type JsonlExport,
  type ViewerInstance,
} from "@open-ocpp-trace/viewer-standalone";

import "./page.css";
import { type HostConfig, resolveHostConfig } from "./config.ts";
import { createGatewayFeed, type GatewayFeedCounters, type HelloOutcome } from "./feed.ts";
import { type ConnectionState, createSseTransport } from "./transport.ts";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`the page has no #${id} element`);
  return element as T;
}

const root = byId("gateway");
const statusLine = byId("status");
const notice = byId("notice");
const viewerHost = byId("viewer");

const COUNTERS: Readonly<Record<keyof GatewayFeedCounters, HTMLElement>> = {
  received: byId("count-received"),
  deliveryUpdates: byId("count-delivery-updates"),
  ignoredUpdates: byId("count-ignored-updates"),
  droppedByServer: byId("count-dropped-by-server"),
  evicted: byId("count-evicted"),
  invalid: byId("count-invalid"),
};

const STATE_TEXT: Readonly<Record<ConnectionState, string>> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
  "auth-failed": "Authentication failed: reload the page to sign in again",
};

function showNotice(text: string): void {
  notice.textContent = text;
  notice.hidden = false;
}

function showState(state: ConnectionState, retryInMs?: number): void {
  statusLine.dataset["state"] = state;
  statusLine.textContent =
    retryInMs === undefined
      ? STATE_TEXT[state]
      : `${STATE_TEXT[state]} in ${Math.ceil(retryInMs / 1000)} s`;
}

/** Saves the export the user asked for; frames and gaps are never in it. */
function download(exported: JsonlExport, scope: ExportScope): void {
  const { unparsed, gap, invalid } = exported.skipped;
  showNotice(
    `Exported ${exported.recordCount} records (${scope}); left out ` +
      `${unparsed} unparsed frames, ${gap} gaps and ${invalid} invalid records.`,
  );
  if (exported.recordCount === 0) return;
  const url = URL.createObjectURL(new Blob([exported.text], { type: "application/jsonl" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `ocpp-gateway-${scope}-${new Date().toISOString()}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function start(config: HostConfig): void {
  byId("events-url").textContent = config.eventsUrl;
  let viewer: ViewerInstance | undefined;
  let maxEntries = 0;
  let countersQueued = false;

  const feed = createGatewayFeed({
    onHello({ hello, first, restarted }: HelloOutcome) {
      if (first) {
        // The viewer keeps as many entries as the gateway buffers. A store's
        // bounds are fixed when it is created, so a later restart with
        // another buffer size keeps this one until the page is reloaded.
        maxEntries = hello.maxBufferedMessages;
        viewer = mount(viewerHost, {
          maxEntries,
          adapter: feed.adapter,
          onExport: download,
        });
      } else if (restarted && hello.maxBufferedMessages !== maxEntries) {
        showNotice(
          `The gateway restarted with a buffer of ${hello.maxBufferedMessages} messages; ` +
            `this page keeps ${maxEntries} until it is reloaded.`,
        );
      }
    },
  });

  function renderCounters(): void {
    countersQueued = false;
    const counters = feed.counters();
    for (const key of Object.keys(COUNTERS) as (keyof GatewayFeedCounters)[]) {
      COUNTERS[key].textContent = String(counters[key]);
    }
  }

  const transport = createSseTransport({
    url: config.eventsUrl,
    credentials: config.credentials,
    headers: config.headers,
    onEvent({ event, data }) {
      feed.receive(event, data);
      if (!countersQueued) {
        countersQueued = true;
        requestAnimationFrame(renderCounters);
      }
    },
    onState: showState,
    onLost: (at) => feed.connectionLost(new Date(at).toISOString()),
  });
  transport.start();
  addEventListener("pagehide", () => {
    transport.stop();
    viewer?.unmount();
  });
}

try {
  start(
    resolveHostConfig({
      baseURI: document.baseURI,
      search: location.search,
      dataset: root.dataset,
    }),
  );
} catch (error) {
  showState("disconnected");
  showNotice(error instanceof Error ? error.message : String(error));
}
