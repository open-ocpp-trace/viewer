// Imports the viewer-standalone asset by file URL from a directory that has
// no node_modules anywhere above it, as a `<script type="module">` would load
// it: a bare import specifier left in the asset fails to resolve.
//
// Usage: node standalone.mjs <path to the copied dist/index.js>

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const asset = process.argv[2];
assert.ok(asset, "usage: node standalone.mjs <asset>");

const standalone = await import(pathToFileURL(asset).href);

assert.equal(typeof standalone.VIEWER_STANDALONE_VERSION, "string");
const bundled = standalone.bundledReactVersion();
assert.match(bundled, /^19\./, `the asset bundles React ${bundled}`);

console.log(
  `viewer-standalone ${standalone.VIEWER_STANDALONE_VERSION}: self-contained, bundles React ${bundled}`,
);
