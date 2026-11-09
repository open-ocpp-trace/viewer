import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
    dts: true,
    // Fail the build if dist imports anything but the SDK core, Node
    // built-ins included: the neutral platform does not allow them.
    deps: { onlyImport: ["@open-ocpp-trace/core"] },
  },
});
