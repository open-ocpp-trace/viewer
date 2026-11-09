import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type ViewerErrorHandler,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { call } from "./correlation-fixtures.ts";
import { add } from "./store-fixtures.ts";

const listenerContext = { component: "correlator", callback: "listener" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A store whose `get` throws for the id `boom`. */
function failingStore(): ViewerStore {
  const store = createViewerStore();
  return {
    ...store,
    get: (id) => {
      if (id === "boom") throw new Error("get");
      return store.get(id);
    },
  };
}

describe("Correlator error reporting", () => {
  it("reports a listener error to globalThis.reportError by default, synchronously", () => {
    const reportError = vi.fn();
    const correlator = createCorrelator();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("listener");
    correlator.subscribe(() => {
      throw failure;
    });
    const store = createViewerStore();
    correlator.connect(store);

    expect(() => store.apply([add(call("c1", "m1"))])).not.toThrow();
    expect(reportError.mock.calls).toEqual([[failure]]);
  });

  it("reports a listener error to console.error without reportError", () => {
    vi.stubGlobal("reportError", undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const correlator = createCorrelator();
    const failure = new Error("listener");
    correlator.subscribe(() => {
      throw failure;
    });
    const store = createViewerStore();
    correlator.connect(store);

    store.apply([add(call("c1", "m1"))]);
    expect(log.mock.calls).toEqual([[failure]]);
  });

  it("reports each throwing listener to onError and still notifies the others", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const correlator = createCorrelator({ onError });
    const first = new Error("first");
    const second = new Error("second");
    const versions: number[] = [];
    correlator.subscribe(() => {
      throw first;
    });
    correlator.subscribe(() => {
      throw second;
    });
    correlator.subscribe((change) => versions.push(change.version));
    const store = createViewerStore();
    correlator.connect(store);

    store.apply([add(call("c1", "m1"))]);

    expect(versions).toEqual([1]);
    expect(onError.mock.calls).toEqual([
      [first, listenerContext],
      [second, listenerContext],
    ]);
  });

  it("reports an error while following the store as follow", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const correlator = createCorrelator({ onError });
    const store = failingStore();
    correlator.connect(store);

    store.apply([add(call("boom", "m1"))]);

    expect(onError.mock.calls).toEqual([
      [new Error("get"), { component: "correlator", callback: "follow" }],
    ]);
  });

  it("reports both errors to the default once each when onError throws", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const handlerError = new Error("handler");
    const onError = vi.fn<ViewerErrorHandler>(() => {
      throw handlerError;
    });
    const correlator = createCorrelator({ onError });
    const failure = new Error("listener");
    correlator.subscribe(() => {
      throw failure;
    });
    const store = createViewerStore();
    correlator.connect(store);

    expect(() => store.apply([add(call("c1", "m1"))])).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls).toEqual([[failure], [handlerError]]);
  });
});
