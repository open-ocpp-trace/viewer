import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "browser",
    dts: true,
    deps: {
      // React is a peer dependency: the host provides the single React copy.
      neverBundle: ["react", "react-dom", /^react\//, /^react-dom\//],
    },
  },
});
