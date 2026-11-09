import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "browser",
    dts: true,
    // The stylesheet is not imported by the code: hosts import
    // `@open-ocpp-trace/viewer-react/styles.css` themselves.
    copy: [{ from: "src/styles.css", to: "dist" }],
    deps: {
      // React is a peer dependency: the host provides the single React copy.
      neverBundle: ["react", "react-dom", /^react\//, /^react-dom\//],
    },
  },
});
