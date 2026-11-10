import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = join(root, "node_modules/.bin/tsc");

let workspace: string | undefined;

afterEach(() => {
  if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

it("type-checks the ts and tsx snippets of the README", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const snippets = [...readme.matchAll(/^```(tsx?)\n([\s\S]*?)^```$/gm)];
  expect(snippets.length).toBeGreaterThan(0);

  workspace = mkdtempSync(join(tmpdir(), "readme-snippets-"));
  snippets.forEach(([, lang, code], index) => {
    // `export {}` makes each snippet a module, so their names do not clash.
    writeFileSync(join(workspace!, `snippet-${index}.${lang}`), `export {};\n${code}`);
  });
  writeFileSync(join(workspace, "css.d.ts"), 'declare module "*.css";\n');
  const pkg = (name: string): string[] => [join(root, `packages/${name}/src/index.ts`)];
  const react = join(root, "packages/react/node_modules/@types/react");
  const tsconfig = {
    extends: join(root, "tsconfig.base.json"),
    compilerOptions: {
      lib: ["ES2022", "DOM"],
      jsx: "react-jsx",
      declaration: false,
      isolatedDeclarations: false,
      paths: {
        "@open-ocpp-trace/viewer-core": pkg("core"),
        "@open-ocpp-trace/viewer-react": pkg("react"),
        "@open-ocpp-trace/viewer-standalone": pkg("standalone"),
        react: [join(react, "index.d.ts")],
        "react/jsx-runtime": [join(react, "jsx-runtime.d.ts")],
      },
    },
    include: ["*.ts", "*.tsx"],
  };
  writeFileSync(join(workspace, "tsconfig.json"), JSON.stringify(tsconfig));

  const result = spawnSync(tsc, ["--noEmit", "-p", workspace], { encoding: "utf8" });
  expect(result.stdout + result.stderr).toBe("");
  expect(result.status).toBe(0);
}, 60_000);
