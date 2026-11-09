import { defaultServerConditions, defineConfig } from "vite-plus";

// Workspace packages export their TypeScript sources under this condition so
// that a package can be type-checked and tested against a sibling without
// building it first. The same name is listed in `customConditions` in
// tsconfig.base.json; published consumers never set it and resolve `dist`.
// It differs from the SDK's `@open-ocpp-trace/source`, which the published
// SDK tarballs do not ship sources for.
const SOURCE_CONDITION = "@open-ocpp-trace/viewer-source";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, ...defaultServerConditions],
    },
  },
  lint: {
    // The smoke consumer imports the packed packages, which only exist in
    // the throwaway projects of scripts/smoke-consumer.sh; that script
    // type-checks it there with tsc.
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "scripts/smoke-consumer/consumer.ts"],
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
    include: ["packages/*/test/**/*.test.ts"],
  },
});
