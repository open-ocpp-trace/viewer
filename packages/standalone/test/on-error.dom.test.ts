import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ViewerAdapter, ViewerEntry, ViewerErrorHandler } from "@open-ocpp-trace/viewer-core";
import type { ToolbarAction, ViewerActionContext } from "@open-ocpp-trace/viewer-react";
import { mount } from "@open-ocpp-trace/viewer-standalone";

import { host, listedIds, sdkEntry, shadowOf, stubLayout, track } from "./helpers.ts";

stubLayout();

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function button(element: Element, text: string): HTMLButtonElement {
  const found = Array.from(shadowOf(element).querySelectorAll("button")).find(
    (candidate) => candidate.textContent === text,
  );
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

/** An adapter whose promised snapshot cannot be read past its first entry. */
function hostileAdapter(failure: Error): ViewerAdapter {
  const snapshot = new Proxy([sdkEntry("a"), sdkEntry("b")], {
    get(target, key, receiver) {
      if (key === "1") throw failure;
      return Reflect.get(target, key, receiver);
    },
  }) as ViewerEntry[];
  return {
    snapshot: () => Promise.resolve(snapshot),
    subscribe: () => () => undefined,
  };
}

/** A toolbar action subscribing a listener throwing `failure` to the store. */
function watcher(failure: Error): ToolbarAction {
  return {
    id: "watch",
    label: "Watch",
    run: (context: ViewerActionContext) => {
      context.store.subscribe(() => {
        throw failure;
      });
    },
  };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe("mount() onError", () => {
  it("reports a store error to globalThis.reportError by default", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const failure = new Error("unreadable");
    const element = host();
    track(mount(element, { adapter: hostileAdapter(failure) }));

    await settle();
    expect(reportError.mock.calls).toEqual([[failure]]);
    expect(listedIds(element)).toEqual(["a"]);
  });

  it("reports a store error to console.error without reportError", async () => {
    vi.stubGlobal("reportError", undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = new Error("unreadable");
    track(mount(host(), { adapter: hostileAdapter(failure) }));

    await settle();
    expect(log).toHaveBeenCalledWith(failure);
  });

  it("passes store and viewer errors to onError with their context", async () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const onError = vi.fn<ViewerErrorHandler>();
    const snapshotFailure = new Error("unreadable");
    const runFailure = new Error("run");
    const element = host();
    track(
      mount(element, {
        adapter: hostileAdapter(snapshotFailure),
        toolbarActions: [
          {
            id: "boom",
            label: "Boom",
            run: () => {
              throw runFailure;
            },
          },
        ],
        onError,
      }),
    );

    await settle();
    button(element, "Boom").click();

    expect(onError.mock.calls).toEqual([
      [snapshotFailure, { component: "store", callback: "snapshot" }],
      [runFailure, { component: "TraceViewer", callback: "toolbarActions.run" }],
    ]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports both errors to the default once each when onError throws", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const handlerError = new Error("handler");
    const failure = new Error("listener");
    const element = host();
    const instance = track(
      mount(element, {
        entries: [sdkEntry("a")],
        toolbarActions: [watcher(failure)],
        onError: () => {
          throw handlerError;
        },
      }),
    );
    button(element, "Watch").click();

    instance.ingest([sdkEntry("b")]);

    expect(reportError.mock.calls).toEqual([[failure], [handlerError]]);
    expect(listedIds(element)).toEqual(["a", "b"]);
  });

  it("swaps the handler of store errors with setOptions, and keeps working", () => {
    const first = vi.fn<ViewerErrorHandler>();
    const second = vi.fn<ViewerErrorHandler>();
    const failure = new Error("listener");
    const element = host();
    const instance = track(
      mount(element, {
        entries: [sdkEntry("a")],
        toolbarActions: [watcher(failure)],
        onError: first,
      }),
    );
    button(element, "Watch").click();

    instance.ingest([sdkEntry("b")]);
    instance.setOptions({ onError: second });
    instance.ingest([sdkEntry("c")]);

    const context = { component: "store", callback: "listener" };
    expect(first.mock.calls).toEqual([[failure, context]]);
    expect(second.mock.calls).toEqual([[failure, context]]);
    expect(listedIds(element)).toEqual(["a", "b", "c"]);
  });
});
