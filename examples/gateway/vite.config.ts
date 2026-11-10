import { defaultClientConditions, defineConfig } from "vite-plus";

// `vp dev` forwards the page's `events` requests to a gateway viewer server
// (the mock by default), so the page reads them from its own origin. The
// optional Basic credentials stay in this process: the browser never sees
// them.
const gateway = process.env["GATEWAY_URL"] ?? "http://127.0.0.1:9001";
const auth = process.env["GATEWAY_AUTH"];

export default defineConfig({
  // Relative asset URLs, so the built page works under any base path a
  // reverse proxy serves it from.
  base: "./",
  resolve: {
    // Only the conditions of a published install: viewer-standalone resolves
    // to its built `dist/index.js` (run `vp run -r pack` first), as in
    // examples/standalone.
    conditions: [...defaultClientConditions],
  },
  server: {
    proxy: {
      "/events": {
        target: gateway,
        changeOrigin: true,
        ...(auth !== undefined && { auth }),
      },
    },
  },
});
