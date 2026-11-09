// Runs in a throwaway project that installed the packed tarballs next to
// one React version. viewer-react must use the host's React rather than a
// bundled copy: the version it reports is the one the consumer installed.
//
// Usage: node react.mjs <expected React major>

import assert from "node:assert/strict";

import { version as hostVersion } from "react";
import { VIEWER_REACT_VERSION, hostReactVersion } from "@open-ocpp-trace/viewer-react";

const expectedMajor = process.argv[2];
assert.ok(expectedMajor, "usage: node react.mjs <expected React major>");

assert.equal(typeof VIEWER_REACT_VERSION, "string");
assert.equal(
  hostVersion.split(".")[0],
  expectedMajor,
  `the consumer installed React ${hostVersion}`,
);
assert.equal(hostReactVersion(), hostVersion, "viewer-react does not use the host's React");

console.log(`viewer-react ${VIEWER_REACT_VERSION}: uses the host's React ${hostVersion}`);
