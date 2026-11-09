// Runs in a throwaway project that installed the packed tarballs next to
// one React version. viewer-react must use the host's React rather than a
// bundled copy: the version it reports is the one the consumer installed.
// Its stylesheet must resolve through the `./styles.css` export.
//
// Usage: node react.mjs <expected React major>

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement, version as hostVersion } from "react";
import { renderToString } from "react-dom/server";
import { createViewerStore } from "@open-ocpp-trace/viewer-core";
import { TraceViewer, VIEWER_REACT_VERSION, hostReactVersion } from "@open-ocpp-trace/viewer-react";

const expectedMajor = process.argv[2];
assert.ok(expectedMajor, "usage: node react.mjs <expected React major>");

assert.equal(typeof VIEWER_REACT_VERSION, "string");
assert.equal(
  hostVersion.split(".")[0],
  expectedMajor,
  `the consumer installed React ${hostVersion}`,
);
assert.equal(hostReactVersion(), hostVersion, "viewer-react does not use the host's React");

const stylesheet = fileURLToPath(import.meta.resolve("@open-ocpp-trace/viewer-react/styles.css"));
assert.ok(existsSync(stylesheet), `the styles.css export points at a missing ${stylesheet}`);

// The engine connects to the store in an effect, which a server render
// never runs: the markup holds the toolbar and the grid header, not rows.
const store = createViewerStore();
store.load([{ kind: "gap", id: "g", reason: "disconnected" }]);
const html = renderToString(createElement(TraceViewer, { store }));
for (const text of ["Pause", "Follow latest", "Filters", "Timestamp", "Message ID"]) {
  assert.ok(html.includes(text), `the server-rendered viewer lacks "${text}"`);
}

console.log(`viewer-react ${VIEWER_REACT_VERSION}: uses the host's React ${hostVersion}`);
