import { defaultClientConditions, defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    // Only the conditions of a published install: viewer-core and
    // viewer-react resolve to their built `dist/` (run `vp run -r pack`
    // first), styles.css included, never to their sources through the
    // `@open-ocpp-trace/viewer-source` condition that apps/playground and
    // the root config use. The root config runs this example's tests
    // against the sources.
    conditions: [...defaultClientConditions],
  },
});
