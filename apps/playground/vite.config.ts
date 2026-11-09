import { defaultClientConditions, defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    // Resolve the workspace packages to their TypeScript sources (the
    // condition of the root vite.config.ts), so the playground runs and
    // builds without packing them first.
    conditions: ["@open-ocpp-trace/viewer-source", ...defaultClientConditions],
  },
});
