import { describe, expect, it } from "vite-plus/test";

import { decodeHostState, encodeHostState } from "../src/host-state.ts";

describe("host state in the URL hash", () => {
  it("round-trips the filter groups and the selection the page controls", () => {
    const state = {
      filter: {
        chargePointIds: ["CP002"],
        directions: ["cp-to-csms"],
        messageTypes: ["CALLERROR", "CALL"],
        actions: ["FooBar"],
        fields: [{ id: "payloadConnector", values: ["1"] }],
      },
      selection: { entryId: "sim-24" },
    };
    const hash = encodeHostState(state);
    expect(hash.startsWith("#")).toBe(true);
    expect(decodeHostState(hash)).toEqual(state);
  });

  it("encodes the empty state as an empty hash", () => {
    expect(encodeHostState({ filter: {}, selection: { entryId: null } })).toBe("");
    expect(decodeHostState("")).toEqual({ filter: {}, selection: { entryId: null } });
  });

  it("keeps values holding separators and drops unknown keys", () => {
    const state = { filter: { actions: ["A,B&C=D"] }, selection: { entryId: null } };
    expect(decodeHostState(encodeHostState(state))).toEqual(state);
    expect(decodeHostState("#bogus=1&cp=CP001")).toEqual({
      filter: { chargePointIds: ["CP001"] },
      selection: { entryId: null },
    });
  });
});
