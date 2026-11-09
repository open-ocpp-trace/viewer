import { describe, expect, it, vi } from "vite-plus/test";

import type { EntryUpdate, ViewerAdapter } from "@open-ocpp-trace/viewer-core";
import { mount, type MountOptions } from "@open-ocpp-trace/viewer-standalone";

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

  it.each([
    ["null", null],
    ["a string", "theme"],
    ["a number", 1],
    ["a boolean", true],
    ["a function", () => ({})],
  ])(
    "rejects %s as options, before the element check, and leaves the element empty",
    (_, value) => {
      const element = host();
      const options = value as unknown as MountOptions;
      const message = "mount() needs an options object";

      expect(() => mount(element, options)).toThrow(new TypeError(message));
      expect(() => mount(null as unknown as Element, options)).toThrow(new TypeError(message));
      expect(element.childNodes).toHaveLength(0);
      track(mount(element));
    },
  );

  it("accepts undefined options", () => {
    track(mount(host(), undefined));
  });

  it.each([
    "store",
    "correlator",
    "renderPayload",
    "filterControls",
    "detailPanels",
    "className",
    "bogus",
  ])("rejects the unknown option %s and leaves the element empty", (key) => {
    const element = host();
    const options = { [key]: undefined } as unknown as MountOptions;

    expect(() => mount(element, options)).toThrow(TypeError);
    expect(() => mount(element, options)).toThrow(`"${key}"`);
    expect(element.childNodes).toHaveLength(0);
    track(mount(element));
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

  it("adopts each css its own sheet, and one sheet per css in a document", () => {
    const attach = (css: string): ShadowRoot => {
      const root = document.createElement("div").attachShadow({ mode: "open" });
      attachStyles(root, css, undefined);
      return root;
    };
    const rules = (root: ShadowRoot): string =>
      root.adoptedStyleSheets
        .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
        .join("\n");

    const first = attach(".oot-first { color: red; }");
    const second = attach(".oot-second { color: blue; }");
    const again = attach(".oot-first { color: red; }");

    expect(rules(first)).toContain(".oot-first");
    expect(rules(second)).toContain(".oot-second");
    expect(rules(second)).not.toContain(".oot-first");
    expect(again.adoptedStyleSheets[0]).toBe(first.adoptedStyleSheets[0]);
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
