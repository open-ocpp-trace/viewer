// Runs in a throwaway project that installed the packed tarballs next to
// one React version. viewer-react must use the host's React rather than a
// bundled copy: the version it reports is the one the consumer installed.
// Its stylesheet must resolve through the `./styles.css` export.
//
// Usage: node react.mjs <expected React major>

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createElement, version as hostVersion } from "react";
import { renderToString } from "react-dom/server";
import { createViewerStore } from "@open-ocpp-trace/viewer-core";
import {
  EntryInspector,
  TraceViewer,
  VIEWER_REACT_VERSION,
  exportJsonl,
  hostReactVersion,
} from "@open-ocpp-trace/viewer-react";

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

// The inspector reads the store during the render itself, so the server
// markup already details the entry.
const record = {
  schemaVersion: "1.1",
  timestamp: "2026-11-09T10:00:00.000Z",
  ocppVersion: "1.6",
  transport: "json",
  chargePointId: "CP-1",
  direction: "cp-to-csms",
  messageType: "CALL",
  messageId: "m-1",
  action: "DataTransfer",
  payload: { vendorId: "smoke-inspected-payload" },
};
const inspected = createViewerStore();
inspected.load([{ kind: "trace", id: "t", record }]);
const details = renderToString(createElement(EntryInspector, { store: inspected, entryId: "t" }));
for (const text of ["Entry details", "DataTransfer", "smoke-inspected-payload"]) {
  assert.ok(details.includes(text), `the server-rendered inspector lacks "${text}"`);
}

// The export goes through the SDK writer, which the package imports from
// the installed @open-ocpp-trace/jsonl rather than bundling it.
const exported = exportJsonl([{ kind: "trace", id: "t", record }]);
assert.equal(exported.text, `${JSON.stringify(record)}\n`, "exportJsonl wrote another line");
assert.equal(exported.recordCount, 1);
const entry = readFileSync(
  fileURLToPath(import.meta.resolve("@open-ocpp-trace/viewer-react")),
  "utf8",
);
assert.ok(
  entry.includes('from "@open-ocpp-trace/jsonl/writer"'),
  "viewer-react bundles the SDK writer instead of importing @open-ocpp-trace/jsonl/writer",
);

console.log(`viewer-react ${VIEWER_REACT_VERSION}: uses the host's React ${hostVersion}`);
