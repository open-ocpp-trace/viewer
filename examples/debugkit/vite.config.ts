import { fileURLToPath } from "node:url";

import { defaultClientConditions, defineConfig } from "vite-plus";

// The stylesheet export of viewer-react points at `dist`, which only exists
// once the package is packed; the example reads the source file instead.
const VIEWER_STYLES = fileURLToPath(
  new URL("../../packages/react/src/styles.css", import.meta.url),
);

export default defineConfig({
  resolve: {
    // Resolve the workspace packages to their TypeScript sources (the
    // condition of the root vite.config.ts), so the example runs and builds
    // without packing them first.
    conditions: ["@open-ocpp-trace/viewer-source", ...defaultClientConditions],
    alias: [{ find: /^@open-ocpp-trace\/viewer-react\/styles\.css$/, replacement: VIEWER_STYLES }],
    // DebugKit's components and the viewer must share one React.
    dedupe: ["react", "react-dom"],
  },
  // The root vite.config.ts lists this folder as a test project, so the
  // example's tests run with `vp test` from either place.
  test: {
    name: "debugkit",
    include: ["test/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    setupFiles: ["test/setup.ts"],
  },
});
