import { describe, expect, it, vi } from "vite-plus/test";

import type { EntryUpdate, ViewerAdapter } from "@open-ocpp-trace/viewer-core";
import { mount } from "@open-ocpp-trace/viewer-standalone";

import { attachStyles } from "../src/styles.ts";
import { host, sdkEntry, shadowOf, stylesOf, track } from "./helpers.ts";

describe("mount", () => {
  it("renders the viewer into an open shadow root of a container it appends", () => {
    const element = host();
    track(mount(element));

    const container = element.lastElementChild;
    expect(container?.hasAttribute("data-oot-standalone")).toBe(true);
    expect(element.shadowRoot).toBeNull();
    expect(container?.shadowRoot?.mode).toBe("open");
    expect(shadowOf(element).querySelector(".oot-viewer")).not.toBeNull();
    expect(document.querySelector(".oot-viewer")).toBeNull();
  });

  it("injects the viewer stylesheet into the shadow root", () => {
    const element = host();
    track(mount(element));

    expect(stylesOf(element)).toContain(".oot-viewer");
    expect(document.head.querySelector("style")).toBeNull();
  });

  it("rejects what is not an element", () => {
    expect(() => mount(null as unknown as Element)).toThrow(TypeError);
    expect(() => mount(document.createTextNode("x") as unknown as Element)).toThrow(TypeError);
  });

  it("refuses a second instance on an element that already holds one", () => {
    const element = host();
    track(mount(element));

    expect(() => mount(element)).toThrow(/already/);
    expect(element.querySelectorAll(":scope > [data-oot-standalone]")).toHaveLength(1);
  });

  it("leaves the host's own children in place", () => {
    const element = host();
    const own = document.createElement("p");
    element.append(own);
    const instance = mount(element);

    instance.unmount();

    expect(Array.from(element.childNodes)).toEqual([own]);
  });

  it("unmounts idempotently and mounts again on the same element", () => {
    const element = host();
    const instance = mount(element, { entries: [sdkEntry("a")] });

    instance.unmount();
    instance.unmount();

    expect(element.childNodes).toHaveLength(0);
    const again = track(mount(element));
    expect(shadowOf(element).querySelector(".oot-viewer")).not.toBeNull();
    expect(stylesOf(element)).toContain(".oot-viewer");
    again.unmount();
    expect(element.childNodes).toHaveLength(0);
  });

  it("throws from every method once unmounted", () => {
    const instance = mount(host());
    instance.unmount();

    expect(() => instance.ingest([sdkEntry("a")])).toThrow(/unmounted/);
    expect(() => instance.update([])).toThrow(/unmounted/);
  });

  it("connects the adapter and unsubscribes it once on unmount", () => {
    const unsubscribe = vi.fn();
    let push: ((updates: readonly EntryUpdate[]) => void) | undefined;
    const adapter: ViewerAdapter = {
      snapshot: () => [sdkEntry("a")],
      subscribe: (listener) => {
        push = listener;
        return unsubscribe;
      },
    };
    const element = host();
    const instance = mount(element, { adapter });

    expect(push).toBeTypeOf("function");
    instance.unmount();
    instance.unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("removes what it created when the adapter throws on connect", () => {
    const element = host();
    const adapter: ViewerAdapter = {
      snapshot: () => [],
      subscribe: () => {
        throw new Error("offline");
      },
    };

    expect(() => mount(element, { adapter })).toThrow("offline");
    expect(element.childNodes).toHaveLength(0);
    track(mount(element));
  });
});

describe("attachStyles", () => {
  it("adopts a constructable sheet when the shadow root supports it", () => {
    const root = document.createElement("div").attachShadow({ mode: "open" });

    attachStyles(root, ".oot-x { color: red; }", undefined);

    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(root.querySelector("style")).toBeNull();
  });

  it("falls back to a <style> element carrying the nonce", () => {
    const root = document.createElement("div").attachShadow({ mode: "open" });
    Object.defineProperty(root, "adoptedStyleSheets", { value: undefined });

    attachStyles(root, ".oot-x { color: red; }", "abc");

    const style = root.querySelector("style");
    expect(style?.textContent).toBe(".oot-x { color: red; }");
    expect(style?.nonce).toBe("abc");
  });
});
