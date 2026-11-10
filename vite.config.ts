import { fileURLToPath } from "node:url";

import {
  configDefaults,
  defaultClientConditions,
  defaultServerConditions,
  defineConfig,
} from "vite-plus";

// Workspace packages export their TypeScript sources under this condition so
// that a package can be type-checked and tested against a sibling without
// building it first. The same name is listed in `customConditions` in
// tsconfig.base.json; published consumers never set it and resolve `dist`.
// It differs from the SDK's `@open-ocpp-trace/source`, which the published
// SDK tarballs do not ship sources for.
const SOURCE_CONDITION = "@open-ocpp-trace/viewer-source";

// node_modules of packages/react/test/react-18, which pins React 18.
const REACT_18 = fileURLToPath(
  new URL("packages/react/test/react-18/node_modules", import.meta.url),
);

// The stylesheet export of viewer-react points at `dist`, which only exists
// once the package is packed; the standalone tests read the source file (as
// apps/playground does), keeping the `?inline` query that makes it a string.
const VIEWER_STYLES = fileURLToPath(new URL("packages/react/src/styles.css", import.meta.url));

export default defineConfig({
  // The React tests run in a DOM environment, which resolves imports like a
  // browser (client conditions) rather than like a server.
  resolve: {
    conditions: [SOURCE_CONDITION, ...defaultClientConditions],
    alias: [
      {
        find: /^@open-ocpp-trace\/viewer-react\/styles\.css(\?inline)?$/,
        replacement: `${VIEWER_STYLES}$1`,
      },
    ],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, ...defaultServerConditions],
    },
  },
  lint: {
    // The smoke consumer imports the packed packages, which only exist in
    // the throwaway projects of scripts/smoke-consumer.sh; that script
    // type-checks it there with tsc.
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "scripts/smoke-consumer/consumer.ts",
      "scripts/smoke-consumer/standalone/consumer.ts",
    ],
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    // The vendored specification fixtures stay byte for byte as published;
    // scripts/sync-spec-fixtures.sh is the only thing that writes them.
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "bun.lock",
      "packages/core/test/fixtures/spec/**",
    ],
  },
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: [
            ...configDefaults.exclude,
            "packages/react/test/**",
            "packages/standalone/test/**/*.dom.test.ts",
          ],
        },
      },
      {
        test: {
          name: "standalone",
          include: ["packages/standalone/test/**/*.dom.test.ts"],
          environment: "happy-dom",
          // Return the stylesheet the package inlines, not an empty string.
          css: { include: [/styles\.css/] },
        },
      },
      {
        // The OCPP Gateway example: its adapter, SSE parser and transport
        // are DOM-free, so they run under Node.js.
        test: {
          name: "gateway",
          include: ["examples/gateway/test/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "examples/gateway/test/**/*.dom.test.ts"],
        },
      },
      {
        // The gateway page's counters against a mounted viewer-standalone.
        test: {
          name: "gateway-dom",
          include: ["examples/gateway/test/**/*.dom.test.ts"],
          environment: "happy-dom",
        },
      },
      {
        test: {
          name: "react",
          include: ["packages/react/test/**/*.test.{ts,tsx}"],
          exclude: [...configDefaults.exclude, "packages/react/test/react-18.test.tsx"],
          environment: "happy-dom",
          setupFiles: ["packages/react/test/setup.ts"],
        },
      },
      // The DebugKit integration example (examples/debugkit/**/*.test.{ts,tsx}),
      // configured by its own vite.config.ts.
      "examples/debugkit",
      {
        // The simulator example: its adapter against the captured fixture,
        // and a render of its page.
        test: {
          name: "example-simulator",
          include: ["examples/simulator/test/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
          setupFiles: ["examples/simulator/test/setup.ts"],
        },
      },
      {
        // The same React tests against React 18. The workspace package in
        // REACT_18 installs React 18 with its own copies of the packages that
        // import React, so Node resolves every `react` they load to 18 too;
        // these aliases point the sources and tests at those copies.
        resolve: {
          alias: [
            { find: /^react(\/.*)?$/, replacement: `${REACT_18}/react$1` },
            { find: /^react-dom(\/.*)?$/, replacement: `${REACT_18}/react-dom$1` },
            {
              find: /^@testing-library\/react$/,
              replacement: `${REACT_18}/@testing-library/react`,
            },
            {
              find: /^@tanstack\/react-virtual$/,
              replacement: `${REACT_18}/@tanstack/react-virtual`,
            },
          ],
        },
        test: {
          name: "react18",
          include: ["packages/react/test/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
          setupFiles: ["packages/react/test/setup.ts"],
        },
      },
    ],
  },
});
