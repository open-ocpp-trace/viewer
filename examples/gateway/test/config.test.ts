import { describe, expect, it } from "vite-plus/test";

import { resolveHostConfig } from "../src/config.ts";

const BASE = "https://proxy.test/ops/gateway/";

describe("host configuration", () => {
  it("resolves the events URL relative to the page, behind a base path", () => {
    expect(resolveHostConfig({ baseURI: BASE, search: "", dataset: {} })).toEqual({
      eventsUrl: "https://proxy.test/ops/gateway/events",
      credentials: "same-origin",
      headers: {},
    });
  });

  it("takes the URL and credentials from the data attributes, then the query string", () => {
    const dataset = { eventsUrl: "../stream", credentials: "include" };
    expect(resolveHostConfig({ baseURI: BASE, search: "", dataset })).toMatchObject({
      eventsUrl: "https://proxy.test/ops/stream",
      credentials: "include",
    });
    expect(
      resolveHostConfig({
        baseURI: BASE,
        search: "?events=https%3A%2F%2Fgw.test%3A9001%2Fevents&credentials=omit",
        dataset,
      }),
    ).toMatchObject({ eventsUrl: "https://gw.test:9001/events", credentials: "omit" });
  });

  it("reads extra headers from a data attribute only", () => {
    expect(
      resolveHostConfig({
        baseURI: BASE,
        search: "?headers=%7B%22x-a%22%3A%221%22%7D",
        dataset: { headers: '{"x-proxy":"viewer"}' },
      }).headers,
    ).toEqual({ "x-proxy": "viewer" });
  });

  it("rejects a non-HTTP URL, unknown credentials and malformed headers", () => {
    expect(() =>
      resolveHostConfig({ baseURI: BASE, search: "?events=javascript:alert(1)", dataset: {} }),
    ).toThrow(/http/);
    expect(() =>
      resolveHostConfig({ baseURI: BASE, search: "?credentials=all", dataset: {} }),
    ).toThrow(/credentials/);
    expect(() =>
      resolveHostConfig({ baseURI: BASE, search: "", dataset: { headers: '{"a":1}' } }),
    ).toThrow(/headers/);
  });
});
