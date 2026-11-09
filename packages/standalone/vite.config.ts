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
      // The asset is loaded by a plain `<script type="module">`: React is
      // bundled (workspace packages are bundled as local files), no other
      // `node_modules` package may be, and the output may import nothing.
      onlyBundle: ["react"],
      onlyImport: [],
    },
  },
});
