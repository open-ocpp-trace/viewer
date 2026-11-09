import { afterEach } from "vite-plus/test";

import type { ViewerInstance } from "@open-ocpp-trace/viewer-standalone";

export { add, sdkEntry } from "../../react/test/fixtures.ts";
export { stubLayout } from "../../react/test/layout.ts";

const hosts: HTMLElement[] = [];

/**
 * A fresh host element attached to the document, removed after the test
 * (with any instance the test left mounted, see {@link track}).
 */
export function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  hosts.push(element);
  return element;
}

const instances: ViewerInstance[] = [];

/** Unmounts `instance` after the test, whatever the test did with it. */
export function track(instance: ViewerInstance): ViewerInstance {
  instances.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of instances.splice(0)) instance.unmount();
  for (const element of hosts.splice(0)) element.remove();
});

/** The shadow root of the viewer mounted in `element`. */
export function shadowOf(element: Element): ShadowRoot {
  const container = element.querySelector(":scope > [data-oot-standalone]");
  const root = container?.shadowRoot;
  if (root === null || root === undefined) throw new Error("no viewer mounted here");
  return root;
}

/** The entry ids of the rows listed in the viewer mounted in `element`. */
export function listedIds(element: Element): string[] {
  return Array.from(
    shadowOf(element).querySelectorAll<HTMLElement>('[role="grid"] [role="row"][data-entry-id]'),
    (row) => row.dataset["entryId"] ?? "",
  );
}

/** The row of `id` in the viewer mounted in `element`. */
export function rowOf(element: Element, id: string): HTMLElement {
  const row = shadowOf(element).querySelector<HTMLElement>(
    `[role="grid"] [role="row"][data-entry-id="${id}"]`,
  );
  if (row === null) throw new Error(`no row for ${id}`);
  return row;
}

/** The text of every stylesheet the shadow root of `element` applies. */
export function stylesOf(element: Element): string {
  const root = shadowOf(element);
  const adopted = (root.adoptedStyleSheets ?? []).flatMap((sheet) =>
    Array.from(sheet.cssRules, (rule) => rule.cssText),
  );
  const inline = Array.from(root.querySelectorAll("style"), (style) => style.textContent ?? "");
  return [...adopted, ...inline].join("\n");
}
