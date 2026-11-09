import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createCorrelator,
  createFilterEngine,
  createViewerStore,
  type CorrelationChange,
  type Correlator,
  type ViewerErrorHandler,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import { simulator } from "./filter-fixtures.ts";
import { add } from "./store-fixtures.ts";

const listenerContext = { component: "filterEngine", callback: "listener" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A store whose `get` and `toArray` throw once `fail` is called. */
function flakyStore(): { store: ViewerStore; source: ViewerStore; fail: () => void } {
  const source = createViewerStore();
  let failing = false;
  const store: ViewerStore = {
    ...source,
    get: (id) => {
      if (failing) throw new Error("get");
      return source.get(id);
    },
    toArray: () => {
      if (failing) throw new Error("toArray");
      return source.toArray();
    },
  };
  return {
    store,
    source,
    fail: () => {
      failing = true;
    },
  };
}

describe("FilterEngine error reporting", () => {
  it("reports a listener error to globalThis.reportError by default, synchronously", () => {
    const reportError = vi.fn();
    const engine = createFilterEngine();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("listener");
    engine.subscribe(() => {
      throw failure;
    });
    const store = createViewerStore();
    engine.connect(store);

    expect(() => store.apply([add(simulator.boot)])).not.toThrow();
    expect(reportError.mock.calls).toEqual([[failure]]);
  });

  it("reports a listener error to console.error without reportError", () => {
    vi.stubGlobal("reportError", undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const engine = createFilterEngine();
    const failure = new Error("listener");
    engine.subscribe(() => {
      throw failure;
    });
    const store = createViewerStore();
    engine.connect(store);

    store.apply([add(simulator.boot)]);
    expect(log.mock.calls).toEqual([[failure]]);
  });

  it("reports each throwing listener to onError and still notifies the others", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const engine = createFilterEngine({ onError });
    const first = new Error("first");
    const second = new Error("second");
    const versions: number[] = [];
    engine.subscribe(() => {
      throw first;
    });
    engine.subscribe(() => {
      throw second;
    });
    engine.subscribe((change) => versions.push(change.version));
    const store = createViewerStore();
    engine.connect(store);

    store.apply([add(simulator.boot)]);

    expect(versions).toEqual([1]);
    expect(onError.mock.calls).toEqual([
      [first, listenerContext],
      [second, listenerContext],
    ]);
  });

  it("reports an error while following the store as follow, then one while refiltering as setFilter", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const engine = createFilterEngine({ onError });
    const { store, source, fail } = flakyStore();
    engine.connect(store);
    fail();

    source.apply([add(simulator.boot)]);
    engine.setFilter({ kinds: ["trace"] });

    expect(onError.mock.calls).toEqual([
      [new Error("get"), { component: "filterEngine", callback: "follow" }],
      [new Error("toArray"), { component: "filterEngine", callback: "setFilter" }],
    ]);
  });

  it("reports an error while following the correlator as correlate", () => {
    const onError = vi.fn<ViewerErrorHandler>();
    const correlator = createCorrelator();
    let notify: ((change: CorrelationChange) => void) | undefined;
    const capturing: Correlator = {
      ...correlator,
      subscribe(listener) {
        notify = listener;
        return () => undefined;
      },
    };
    const engine = createFilterEngine({ correlator: capturing, onError });
    engine.connect(createViewerStore());
    const failure = new Error("cleared");
    const hostile = {
      get cleared(): boolean {
        throw failure;
      },
    } as unknown as CorrelationChange;

    notify?.(hostile);

    expect(onError.mock.calls).toEqual([
      [failure, { component: "filterEngine", callback: "correlate" }],
    ]);
  });

  it("reports both errors to the default once each when onError throws", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const handlerError = new Error("handler");
    const onError = vi.fn<ViewerErrorHandler>(() => {
      throw handlerError;
    });
    const engine = createFilterEngine({ onError });
    const failure = new Error("listener");
    engine.subscribe(() => {
      throw failure;
    });
    const store = createViewerStore();
    engine.connect(store);

    expect(() => store.apply([add(simulator.boot)])).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls).toEqual([[failure], [handlerError]]);
  });
});
