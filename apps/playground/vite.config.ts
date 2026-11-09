import { fileURLToPath } from "node:url";

import { defaultClientConditions, defineConfig } from "vite-plus";

// The stylesheet export of viewer-react points at `dist`, which only exists
// once the package is packed; the playground reads the source file instead.
const VIEWER_STYLES = fileURLToPath(
  new URL("../../packages/react/src/styles.css", import.meta.url),
);

export default defineConfig({
  resolve: {
    // Resolve the workspace packages to their TypeScript sources (the
    // condition of the root vite.config.ts), so the playground runs and
    // builds without packing them first.
    conditions: ["@open-ocpp-trace/viewer-source", ...defaultClientConditions],
    alias: [{ find: /^@open-ocpp-trace\/viewer-react\/styles\.css$/, replacement: VIEWER_STYLES }],
  },
});
