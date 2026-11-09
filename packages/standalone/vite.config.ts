import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "browser",
    dts: true,
    // React reads `process.env.NODE_ENV`, which a browser does not define.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    deps: {
      // The asset is loaded by a plain `<script type="module">`, so the
      // output may import nothing: React, React DOM and every `node_modules`
      // dependency of viewer-react and viewer-core are bundled (workspace
      // packages are bundled as local files), and so are their declarations,
      // which `dist/index.d.ts` inlines. The list is the one the pack asks
      // for; a new dependency of either package fails the pack until added.
      // viewer-react's stylesheet is imported with `?inline`, as a string.
      onlyBundle: [
        "react",
        "react-dom",
        "scheduler",
        "@tanstack/react-virtual",
        "@tanstack/virtual-core",
        "@open-ocpp-trace/core",
        "@open-ocpp-trace/jsonl",
      ],
      onlyImport: [],
    },
  },
});
