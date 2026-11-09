// Imports the viewer-standalone asset by file URL from a directory that has
// no node_modules anywhere above it, as a `<script type="module">` would load
// it: a bare import specifier left in the asset fails to resolve.
//
// A browser has no `process`, `require` or `node:` modules. The asset text
// must not read `process.env`, call `require` or name a `node:` module, and
// `process` is removed from the global scope before the import, so a missing
// `process.env.NODE_ENV` define fails here instead of passing under Node.js.
// React DOM's error reporting keeps a `typeof process` guarded fallback,
// which a browser never reaches, so a bare `process.` is allowed.
//
// Usage: node standalone.mjs <path to the copied dist/index.js>

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const asset = process.argv[2];
assert.ok(asset, "usage: node standalone.mjs <asset>");

const text = readFileSync(asset, "utf8");
for (const nodeOnly of ["process.env", "require(", "node:"]) {
  assert.ok(!text.includes(nodeOnly), `the asset references \`${nodeOnly}\``);
}

delete globalThis.process;
assert.equal(typeof globalThis.process, "undefined", "process is still defined");

const standalone = await import(pathToFileURL(asset).href);

assert.equal(typeof standalone.VIEWER_STANDALONE_VERSION, "string");
const bundled = standalone.bundledReactVersion();
assert.match(bundled, /^19\./, `the asset bundles React ${bundled}`);

console.log(
  `viewer-standalone ${standalone.VIEWER_STANDALONE_VERSION}: self-contained, bundles React ${bundled}`,
);
