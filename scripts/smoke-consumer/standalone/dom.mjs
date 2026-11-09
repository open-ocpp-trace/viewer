// Mounts two viewers from the built viewer-standalone asset into a
// happy-dom document, as a page without React would: the asset must render
// on its own bundled React, keep each viewer in its own shadow root, give
// the host elements back as they were on unmount, and add no global.
//
// happy-dom comes from the workspace (its directory is the second
// argument), not from the consumer, which installs nothing but the asset.
//
// Usage: node dom.mjs <path to dist/index.js> <path to the happy-dom package>

import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [asset, happyDomDir] = process.argv.slice(2);
assert.ok(asset && happyDomDir, "usage: node dom.mjs <asset> <happy-dom directory>");

const { Window } = await import(pathToFileURL(join(happyDomDir, "lib/index.js")).href);
const window = new Window({ url: "https://host.example/app/" });

// Expose the DOM the way a browser does: every name of the window that
// Node.js does not define itself, plus `window` and `document`.
for (const name of Object.getOwnPropertyNames(window)) {
  if (name in globalThis) continue;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: window[name],
  });
}
globalThis.window = window;
globalThis.document = window.document;

// happy-dom does no layout: give the list a viewport, so the virtualizer
// renders rows (as packages/react/test/layout.ts does for the tests).
const ROW_HEIGHT = 28;
const sizes = {
  clientHeight: () => ROW_HEIGHT * 10,
  clientWidth: () => 800,
  scrollHeight: (element) =>
    element.getAttribute("role") === "grid"
      ? Number(element.getAttribute("aria-rowcount")) * ROW_HEIGHT
      : 0,
};
for (const [name, size] of Object.entries(sizes)) {
  Object.defineProperty(window.HTMLElement.prototype, name, {
    configurable: true,
    get() {
      return size(this);
    },
  });
}

function entry(id) {
  return {
    kind: "trace",
    id,
    record: {
      schemaVersion: "1.1",
      timestamp: "2026-11-09T10:00:00.000Z",
      transport: "json",
      direction: "cp-to-csms",
      ocppVersion: "1.6",
      chargePointId: "CP-1",
      messageType: "CALL",
      messageId: `m-${id}`,
      action: "Heartbeat",
      payload: {},
    },
  };
}

function shadowOf(element) {
  const root = element.querySelector(":scope > [data-oot-standalone]")?.shadowRoot;
  assert.ok(root, "no viewer shadow root in the host element");
  return root;
}

function listedIds(element) {
  return Array.from(
    shadowOf(element).querySelectorAll('[role="grid"] [role="row"][data-entry-id]'),
    (row) => row.getAttribute("data-entry-id"),
  );
}

const globalsBefore = new Set(Object.getOwnPropertyNames(globalThis));

const { mount } = await import(pathToFileURL(asset).href);

const document = window.document;
const left = document.createElement("div");
const right = document.createElement("div");
left.append(document.createElement("p"));
document.body.append(left, right);
const leftChildren = Array.from(left.childNodes);

const leftViewer = mount(left, { entries: [entry("a")], theme: { colorScheme: "light" } });
const rightViewer = mount(right, { theme: { colorScheme: "dark" } });
leftViewer.ingest([entry("b")]);
rightViewer.ingest([entry("c")]);

assert.deepEqual(listedIds(left), ["a", "b"]);
assert.deepEqual(listedIds(right), ["c"]);
assert.notEqual(shadowOf(left), shadowOf(right));
assert.equal(
  document.querySelector(".oot-viewer"),
  null,
  "the viewer rendered outside its shadow root",
);

leftViewer.unmount();
rightViewer.unmount();

assert.deepEqual(Array.from(left.childNodes), leftChildren, "the left host was not restored");
assert.equal(right.childNodes.length, 0, "the right host was not restored");

const added = Object.getOwnPropertyNames(globalThis).filter((name) => !globalsBefore.has(name));
assert.deepEqual(added, [], `the asset added globals: ${added.join(", ")}`);

await window.happyDOM.close();
console.log("viewer-standalone: two viewers mounted, rendered and unmounted in a React-free page");
