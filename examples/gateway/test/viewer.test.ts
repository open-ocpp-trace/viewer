// The gateway entries inside the real viewer model: the store, the filter
// engine and the JSONL export the standalone viewer's export buttons use.
import { describe, expect, it } from "vite-plus/test";

import {
  createFilterEngine,
  createViewerStore,
  type TraceFilter,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { exportJsonl } from "@open-ocpp-trace/viewer-react";

import { createGatewayFeed } from "../src/feed.ts";
import { connection, fixtureDoc, play } from "./fixtures.ts";

/** The store after the three fixture connections, lost and reconnected in between. */
function scenarioStore(): ViewerStore {
  const feed = createGatewayFeed({ now: () => "2026-10-29T15:00:00.000Z" });
  const store = createViewerStore({ maxEntries: 50 });
  store.connect(feed.adapter);
  const receive = (name: string, data: string): void => feed.receive(name, data);
  play(receive, connection(1));
  feed.connectionLost("2026-10-29T14:32:10.000Z");
  play(receive, connection(2));
  feed.connectionLost("2026-10-29T14:32:25.000Z");
  play(receive, connection(3));
  return store;
}

const GAPS = ["gateway-gap-1", "gateway-gap-2", "gateway-gap-3"];

function matching(store: ViewerStore, filter: TraceFilter): string[] {
  const engine = createFilterEngine();
  engine.connect(store);
  engine.setFilter(filter);
  return Array.from({ length: engine.size }, (_, i) => engine.at(i)?.id ?? "?").filter(
    (id) => !GAPS.includes(id),
  );
}

describe("filters on the adapter metadata", () => {
  const store = scenarioStore();

  it("by tenant, including the entries without one", () => {
    expect(matching(store, { tenants: ["tenant-b"] })).toEqual([
      "trace-b1",
      "trace-b2",
      "trace-b5",
    ]);
    expect(matching(store, { tenants: [null] })).toEqual(["trace-n1"]);
  });

  it("by charge point, with the same message ids on two charge points", () => {
    expect(matching(store, { chargePointIds: ["CP-002"] })).toEqual([
      "trace-b1",
      "trace-b2",
      "trace-b5",
    ]);
    expect(matching(store, { messageIds: ["1"], chargePointIds: ["CP-001"] })).toEqual([
      "trace-a1",
      "trace-a2",
      "trace-a2s",
    ]);
  });

  it("by session", () => {
    expect(matching(store, { sessionIds: ["session-b2"] })).toEqual(["trace-b5"]);
  });

  it("by direction", () => {
    expect(matching(store, { directions: ["csms-to-cp"] })).toEqual([
      "trace-a2",
      "trace-a2s",
      "trace-b2",
    ]);
  });

  it("by source", () => {
    expect(matching(store, { sourceIds: ["csms:csms-b"] })).toEqual(["trace-a2s"]);
    expect(matching(store, { sourceIds: ["charge-point:CP-001"] })).toEqual([
      "trace-a1",
      "frame-a3",
      "trace-a4",
    ]);
  });

  it("by delivery status, after the updates were applied", () => {
    expect(matching(store, { deliveryStatuses: ["failed"] })).toEqual(["trace-b2"]);
    expect(matching(store, { deliveryStatuses: ["dropped"] })).toEqual(["frame-a3", "trace-a4"]);
    expect(matching(store, { deliveryStatuses: ["queued"] })).toEqual(["trace-n1"]);
    expect(matching(store, { deliveryStatuses: [null] })).toEqual(["trace-a2s"]);
  });

  it("keeps the gaps in a filtered view", () => {
    const engine = createFilterEngine();
    engine.connect(store);
    engine.setFilter({ tenants: ["tenant-b"] });
    const listed = Array.from({ length: engine.size }, (_, i) => engine.at(i)?.id);
    expect(listed.filter((id) => id !== undefined && GAPS.includes(id))).toEqual(GAPS);
  });
});

describe("export", () => {
  it("writes the gateway records unmodified and never the frames or gaps", () => {
    const store = scenarioStore();
    const exported = exportJsonl(store.toArray());

    expect(exported.skipped).toEqual({ unparsed: 1, gap: 3, invalid: 0 });
    expect(exported.recordCount).toBe(8);
    const lines = exported.text.trimEnd().split("\n");
    expect(lines).toHaveLength(8);
    const doc = fixtureDoc(1, "trace-a1");
    expect(JSON.parse(lines[0] ?? "")).toEqual(doc.kind === "trace" ? doc.trace : undefined);
    expect(exported.text).not.toContain("not json");
    expect(exported.text).not.toContain("deliveries");
  });
});
