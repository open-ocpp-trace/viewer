// Runs in a throwaway project that installed the packed tarballs, under
// Node.js and under Bun. viewer-core is framework and DOM neutral, so it
// must import in a plain runtime with no React and no DOM.

import assert from "node:assert/strict";

import * as core from "@open-ocpp-trace/viewer-core";

assert.equal(typeof core.VIEWER_CORE_VERSION, "string");

console.log(`viewer-core ${core.VIEWER_CORE_VERSION}: imported`);
