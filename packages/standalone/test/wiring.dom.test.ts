import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { CorrelatorOptions } from "@open-ocpp-trace/viewer-core";
import { mount } from "@open-ocpp-trace/viewer-standalone";

import { host, track } from "./helpers.ts";

// Records how mount() builds and connects its correlator, while keeping
// the real one so the viewer still renders.
const correlators = vi.hoisted(() => ({
  created: [] as (CorrelatorOptions | undefined)[],
  disconnect: [] as (() => void)[],
}));

vi.mock("@open-ocpp-trace/viewer-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@open-ocpp-trace/viewer-core")>();
  return {
    ...actual,
    createCorrelator: (options?: CorrelatorOptions) => {
      correlators.created.push(options);
      const correlator = actual.createCorrelator(options);
      const connect = correlator.connect.bind(correlator);
      correlator.connect = (store) => {
        const stop = vi.fn(connect(store));
        correlators.disconnect.push(stop);
        return stop;
      };
      return correlator;
    },
  };
});

afterEach(() => {
  correlators.created.length = 0;
  correlators.disconnect.length = 0;
});

describe("the correlator of a mounted viewer", () => {
  it("is created with the default scope and connected", () => {
    track(mount(host()));

    expect(correlators.created).toEqual([{}]);
    expect(correlators.disconnect).toHaveLength(1);
  });

  it("is created with an explicit scope", () => {
    track(mount(host(), { correlation: "chargePoint" }));

    expect(correlators.created).toEqual([{ scope: "chargePoint" }]);
  });

  it("is not created with correlation: false", () => {
    track(mount(host(), { correlation: false }));

    expect(correlators.created).toEqual([]);
    expect(correlators.disconnect).toEqual([]);
  });

  it("is disconnected once on unmount", () => {
    const instance = mount(host());
    const [disconnect] = correlators.disconnect;
    expect(disconnect).not.toHaveBeenCalled();

    instance.unmount();
    instance.unmount();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
