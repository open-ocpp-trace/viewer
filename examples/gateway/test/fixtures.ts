import { readFileSync } from "node:fs";

import type { WireTraceDocument } from "../src/wire.ts";

/** One server-sent event of a fixture, its data as the parsed JSON. */
export interface FixtureEvent {
  readonly event: string;
  readonly data: unknown;
}

/** The events of `fixtures/connection-<n>.json`, deep-frozen. */
export function connection(n: 1 | 2 | 3): readonly FixtureEvent[] {
  const url = new URL(`../fixtures/connection-${n}.json`, import.meta.url);
  return deepFreeze(JSON.parse(readFileSync(url, "utf8")) as FixtureEvent[]);
}

/** The trace document `id` of a fixture connection. */
export function fixtureDoc(n: 1 | 2 | 3, id: string): WireTraceDocument {
  const found = connection(n).find(
    (event) => event.event === "trace" && (event.data as WireTraceDocument).id === id,
  );
  if (found === undefined) throw new Error(`no trace ${id} in connection ${n}`);
  return found.data as WireTraceDocument;
}

/** Feeds `events` to `receive` as the transport would: name and raw data. */
export function play(
  receive: (name: string, data: string) => void,
  events: readonly FixtureEvent[],
): void {
  for (const { event, data } of events) receive(event, JSON.stringify(data));
}

export function hello(maxBufferedMessages: number, startedAt = "2026-10-29T14:00:00.000Z"): string {
  return JSON.stringify({
    serverTime: "2026-10-29T14:32:00.000Z",
    startedAt,
    maxBufferedMessages,
  });
}

/** A minimal CALL document with one queued delivery to `csms-a`. */
export function heartbeatDoc(id: string): WireTraceDocument {
  return {
    id,
    tenantId: "tenant-a",
    sessionId: "session-a1",
    chargePointId: "CP-001",
    seq: 1,
    receivedAt: "2026-10-29T14:32:01.000Z",
    deliveries: [
      {
        target: "csms-a",
        role: "primary",
        status: "queued",
        updatedAt: "2026-10-29T14:32:01.000Z",
      },
    ],
    kind: "trace",
    trace: {
      schemaVersion: "1.1",
      timestamp: "2026-10-29T14:32:01.000Z",
      transport: "json",
      chargePointId: "CP-001",
      direction: "cp-to-csms",
      messageType: "CALL",
      messageId: id,
      action: "Heartbeat",
      payload: {},
      raw: `[2,"${id}","Heartbeat",{}]`,
    },
  };
}

export function deliveryUpdate(id: string, status: string, index = 0): string {
  return JSON.stringify({
    id,
    index,
    delivery: { target: "csms-a", role: "primary", status, updatedAt: "2026-10-29T14:32:02.000Z" },
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
