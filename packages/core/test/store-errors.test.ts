import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createViewerStore, type ViewerErrorHandler } from "@open-ocpp-trace/viewer-core";

import { adds, ids, trace } from "./store-fixtures.ts";

const listenerContext = { component: "store", callback: "listener" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ViewerStore error reporting", () => {
  it("reports a listener error to globalThis.reportError by default, without throwing", () => {
    const reportError = vi.fn();
    const store = createViewerStore();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("listener");
    store.subscribe(() => {
      throw failure;
    });

    expect(() => store.apply(adds("a"))).not.toThrow();
    expect(reportError.mock.calls).toEqual([[failure]]);
    expect(ids(store)).toEqual(["a"]);
  });

  it("reports a listener error to console.error without reportError", () => {
    vi.stubGlobal("reportError", undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createViewerStore();
    const failure = new Error("listener");
    store.subscribe(() => {
      throw failure;
    });

    expect(() => store.apply(adds("a"))).not.toThrow();
    expect(log.mock.calls).toEqual([[failure]]);
  });

  it("reports each throwing listener to onError and still notifies the others", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const store = createViewerStore({ onError });
    const first = new Error("first");
    const second = new Error("second");
    const calls: number[] = [];
    store.subscribe(() => {
      calls.push(1);
      throw first;
    });
    store.subscribe(() => {
      calls.push(2);
      throw second;
    });
    store.subscribe(() => calls.push(3));

    expect(() => store.apply(adds("a"))).not.toThrow();
    expect(calls).toEqual([1, 2, 3]);
    expect(onError.mock.calls).toEqual([
      [first, listenerContext],
      [second, listenerContext],
    ]);
  });

  it("reports both errors to the default once each when onError throws", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const handlerError = new Error("handler");
    const onError = vi.fn<ViewerErrorHandler>(() => {
      throw handlerError;
    });
    const store = createViewerStore({ onError });
    const failure = new Error("listener");
    store.subscribe(() => {
      throw failure;
    });

    expect(() => store.apply(adds("a"))).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls).toEqual([[failure], [handlerError]]);
  });

  it("reports the listener errors of every call that changes the store", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const store = createViewerStore({ onError });
    store.subscribe(() => {
      throw new Error("listener");
    });

    store.load([trace("x")]);
    store.pause();
    store.resume();
    store.clear();

    expect(onError).toHaveBeenCalledTimes(4);
  });

  it("still rethrows a batch error to the caller, reporting the listener's", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const store = createViewerStore({ onError });
    const listenerError = new Error("listener");
    store.subscribe(() => {
      throw listenerError;
    });
    const failure = new Error("iteration");
    const batch = new Proxy(adds("a", "b"), {
      get(target, key, receiver) {
        if (key === "1") throw failure;
        return Reflect.get(target, key, receiver);
      },
    });

    expect(() => store.apply(batch)).toThrow(failure);
    expect(ids(store)).toEqual(["a"]);
    expect(onError.mock.calls).toEqual([[listenerError, listenerContext]]);
  });
});
