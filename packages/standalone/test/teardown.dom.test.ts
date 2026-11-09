import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mount } from "@open-ocpp-trace/viewer-standalone";

import { host, sdkEntry, shadowOf, stubLayout } from "./helpers.ts";

stubLayout();

// Taken before any test mounts a viewer, so the order of the tests does
// not hide a global that the first mount adds.
const initialGlobals = new Set(Object.getOwnPropertyNames(globalThis));

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Counts the listeners added to `target` and not removed since, keyed by
 * event type and listener, as `addEventListener` dedupes them.
 */
function outstandingListeners(target: EventTarget): () => number {
  const live = new Map<string, Set<unknown>>();
  const key = (type: string, options: unknown): string =>
    `${type}:${String(typeof options === "boolean" ? options : (options as { capture?: boolean } | undefined)?.capture === true)}`;
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
    const listeners = live.get(key(type, options)) ?? new Set();
    listeners.add(listener);
    live.set(key(type, options), listeners);
    add(type, listener, options);
  });
  vi.spyOn(target, "removeEventListener").mockImplementation((type, listener, options) => {
    live.get(key(type, options))?.delete(listener);
    remove(type, listener, options);
  });
  return () => Array.from(live.values()).reduce((total, set) => total + set.size, 0);
}

function mountAndUnmountTwo(): void {
  const left = host();
  const right = host();
  const leftViewer = mount(left, { entries: [sdkEntry("a")] });
  const rightViewer = mount(right, { entries: [sdkEntry("b")] });
  expect(shadowOf(left).querySelector('[role="grid"]')).not.toBeNull();
  expect(shadowOf(right).querySelector('[role="grid"]')).not.toBeNull();
  leftViewer.unmount();
  rightViewer.unmount();
  expect(left.childNodes).toHaveLength(0);
  expect(right.childNodes).toHaveLength(0);
}

describe("unmount", () => {
  it("leaves no document or window listener behind across mount cycles", () => {
    const onDocument = outstandingListeners(document);
    const onWindow = outstandingListeners(window);

    // React DOM listens to `selectionchange` once per document, for good:
    // the first cycle sets the baseline, later ones must not grow it.
    mountAndUnmountTwo();
    const baseline = { document: onDocument(), window: onWindow() };
    for (let cycle = 0; cycle < 3; cycle += 1) mountAndUnmountTwo();

    expect({ document: onDocument(), window: onWindow() }).toEqual(baseline);
  });
});

describe("the host page", () => {
  it("needs no React global and gets none from mounting or unmounting", () => {
    for (const name of ["React", "ReactDOM", "__REACT_DEVTOOLS_GLOBAL_HOOK__"]) {
      expect(initialGlobals.has(name), name).toBe(false);
    }

    mountAndUnmountTwo();

    const added = Object.getOwnPropertyNames(globalThis).filter(
      (name) => !initialGlobals.has(name),
    );
    expect(added).toEqual([]);
  });
});
