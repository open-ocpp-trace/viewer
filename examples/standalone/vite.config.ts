import { defaultClientConditions, defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    // Only the conditions of a published install: viewer-standalone resolves
    // to its built `dist/index.js` (run `vp run -r pack` first), never to its
    // sources through the `@open-ocpp-trace/viewer-source` condition that
    // apps/playground and the root config use.
    conditions: [...defaultClientConditions],
  },
});
