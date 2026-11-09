/**
 * Gateway-style streams: several charge points and sessions multiplexed
 * through one store, entries mapped by the gateway adapter sketch.
 */
import type { TraceRecord } from "@open-ocpp-trace/core";
import { describe, expect, it } from "vite-plus/test";

import type { CorrelationScope, TraceEntry } from "@open-ocpp-trace/viewer-core";

import { correlate } from "./correlation-fixtures.ts";
import { type GatewayDelivery, gatewayEntry } from "./sketches/gateway-adapter.ts";
import { deepFreeze } from "./store-fixtures.ts";

const AT = "2026-11-09T10:00:00.000Z";
const SCOPES: readonly CorrelationScope[] = ["conversation", "chargePoint", "global"];

interface FrameInit {
  readonly chargePointId?: string;
  readonly sessionId?: string;
  readonly direction?: TraceRecord["direction"];
  readonly deliveries?: GatewayDelivery[];
}

function delivery(role: GatewayDelivery["role"], status: GatewayDelivery["status"]) {
  return { target: role, role, status, updatedAt: AT } satisfies GatewayDelivery;
}

function frame(
  id: string,
  messageType: TraceRecord["messageType"],
  messageId: string,
  init: FrameInit,
): TraceEntry {
  const chargePointId = init.chargePointId ?? "CP-1";
  const direction = init.direction ?? (messageType === "CALL" ? "cp-to-csms" : "csms-to-cp");
  const record = {
    schemaVersion: "1.1",
    timestamp: AT,
    transport: "json",
    chargePointId,
    direction,
    messageType,
    messageId,
    payload: {},
    ...(messageType === "CALL" && { action: "Heartbeat" }),
  } as TraceRecord;
  const entry = gatewayEntry({
    kind: "trace",
    id,
    tenantId: "tenant-1",
    sessionId: init.sessionId ?? "S1",
    chargePointId,
    receivedAt: AT,
    deliveries: init.deliveries ?? [],
    trace: record,
  });
  return deepFreeze(entry as TraceEntry);
}

const call = (id: string, messageId: string, init: FrameInit = {}) =>
  frame(id, "CALL", messageId, init);
const result = (id: string, messageId: string, init: FrameInit = {}) =>
  frame(id, "CALLRESULT", messageId, init);

describe("Correlator on a gateway stream", () => {
  it("keeps charge points multiplexed with identical message ids apart, except in global", () => {
    const entries = [
      call("a1", "1", { chargePointId: "CP-A" }),
      call("b1", "1", { chargePointId: "CP-B" }),
      result("ra", "1", { chargePointId: "CP-A" }),
      result("rb", "1", { chargePointId: "CP-B" }),
    ];

    for (const scope of ["conversation", "chargePoint"] as const) {
      const { correlator } = correlate(entries, scope);
      expect(correlator.get("ra")).toMatchObject({ callId: "a1", candidates: [] });
      expect(correlator.get("rb")).toMatchObject({ callId: "b1", candidates: [] });
    }
    // The spec rule alone pairs each response with the most recent CALL.
    const { correlator } = correlate(entries, "global");
    expect(correlator.get("ra")).toMatchObject({ callId: "b1", candidates: ["a1"] });
    expect(correlator.get("rb")).toMatchObject({ callId: "a1", candidates: [] });
  });

  it("keeps two sessions of a reconnected charge point apart in the conversation scope", () => {
    // Session S1 lost its connection before the CALL was answered; the
    // charge point reused the message id in S2, where the CSMS answered twice.
    const entries = [
      call("c1", "7", { sessionId: "S1" }),
      call("c2", "7", { sessionId: "S2" }),
      result("r1", "7", { sessionId: "S2" }),
      result("r2", "7", { sessionId: "S2" }),
    ];

    const conversation = correlate(entries, "conversation").correlator;
    expect(conversation.get("r1")).toMatchObject({ callId: "c2", candidates: [] });
    expect(conversation.get("r2")).toEqual({
      role: "orphan",
      messageId: "7",
      candidates: ["c2"],
      candidatesTruncated: false,
      incompleteHistory: false,
    });
    expect(conversation.unansweredCalls()).toEqual(["c1"]);

    for (const scope of ["chargePoint", "global"] as const) {
      const { correlator } = correlate(entries, scope);
      expect(correlator.get("r1")).toMatchObject({ callId: "c2", candidates: ["c1"] });
      expect(correlator.get("r2")).toMatchObject({ callId: "c1", candidates: [] });
      expect(correlator.unansweredCalls()).toEqual([]);
    }
  });

  it("answers a CALL mirrored to two CSMS once and leaves the second answer an orphan", () => {
    const entries = [
      call("c1", "m1", {
        deliveries: [delivery("primary", "written"), delivery("secondary", "written")],
      }),
      result("primary", "m1"),
      result("secondary", "m1"),
    ];

    for (const scope of SCOPES) {
      const { correlator } = correlate(entries, scope);
      expect(correlator.get("primary")).toMatchObject({ callId: "c1", candidates: [] });
      expect(correlator.get("secondary")).toEqual({
        role: "orphan",
        messageId: "m1",
        candidates: ["c1"],
        candidatesTruncated: false,
        incompleteHistory: false,
      });
      expect(correlator.orphanResponses()).toEqual(["secondary"]);
    }
  });

  it("follows the spec rule over a never-forwarded secondary CALL, with the ambiguity visible", () => {
    // Delivery outcomes are deliberately not used for correlation: the
    // response pairs with the most recent CALL, the dropped secondary one,
    // and the primary CALL is listed as a candidate.
    const toChargePoint = { direction: "csms-to-cp" } as const;
    const entries = [
      call("primary", "42", {
        ...toChargePoint,
        deliveries: [delivery("charge-point", "written")],
      }),
      call("secondary", "42", {
        ...toChargePoint,
        deliveries: [delivery("charge-point", "dropped")],
      }),
      result("answer", "42", { direction: "cp-to-csms" }),
    ];

    for (const scope of SCOPES) {
      const { correlator } = correlate(entries, scope);
      expect(correlator.get("answer")).toMatchObject({
        role: "response",
        callId: "secondary",
        candidates: ["primary"],
      });
      expect(correlator.unansweredCalls()).toEqual(["primary"]);
    }
  });
});
