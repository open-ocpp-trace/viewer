// Turns a workspace package manifest into its published form and checks
// the contents of a packed tarball. Used by scripts/pack-release.sh and
// scripts/verify-packages.sh; runs under Node.js type stripping, so only
// erasable TypeScript syntax is allowed here.
//
//   node scripts/release-manifest.ts strip <package.json>   rewrite in place
//   node scripts/release-manifest.ts inspect <tarball>      exit 1 on problems
//   node scripts/release-manifest.ts lockstep <tarball>...  print the shared
//                                                           version, exit 1
//                                                           if not in lockstep
//
// `lockstep` also takes the committed packages/*/package.json files (any
// argument ending in `.json`), to check the versions before packing.
// `strip` is only ever run on the copy extracted from a tarball, never on
// a committed package.json.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Development-only export condition that points at `src/` (see vite.config.ts). */
export const SOURCE_CONDITION = "@open-ocpp-trace/viewer-source";

/** Files a published package may contain besides `dist/`. */
const TOP_LEVEL_FILES: readonly string[] = ["package.json", "README.md", "LICENSE"];

const DEPENDENCY_FIELDS: readonly string[] = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
];

type Manifest = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutSourceCondition(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSourceCondition);
  if (!isObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== SOURCE_CONDITION) result[key] = withoutSourceCondition(entry);
  }
  return result;
}

/** Returns a copy of `manifest` whose `exports` no longer use the source condition. */
export function stripSourceCondition<T extends Manifest>(manifest: T): T {
  if (!("exports" in manifest)) return { ...manifest };
  return { ...manifest, exports: withoutSourceCondition(manifest.exports) } as T;
}

function exportTargets(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") {
    out.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => exportTargets(entry, `${path}[${index}]`, out));
  } else if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      exportTargets(entry, `${path}[${JSON.stringify(key)}]`, out);
    }
  }
}

/**
 * Lists the problems of a packed package, given its manifest and the paths
 * of its files relative to the package root. An empty list means the
 * package is fit to publish.
 */
export function inspectPackage(manifest: Manifest, files: readonly string[]): string[] {
  const problems: string[] = [];
  const present = new Set(files);

  for (const file of ["LICENSE", "README.md"]) {
    if (!present.has(file)) problems.push(`${file} is missing`);
  }
  for (const file of files) {
    if (!TOP_LEVEL_FILES.includes(file) && !file.startsWith("dist/")) {
      problems.push(`${file} is not expected in the package`);
    }
  }

  const targets: [string, string][] = [];
  exportTargets(manifest.exports, "exports", targets);
  for (const [path, target] of targets) {
    if (path.includes(`[${JSON.stringify(SOURCE_CONDITION)}]`)) {
      problems.push(`${path} is a development-only condition`);
    }
    if (!present.has(target.replace(/^\.\//, ""))) {
      problems.push(`${path} points to ${target}, which is not in the package`);
    }
  }

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (!isObject(dependencies)) continue;
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) {
        problems.push(`${field}[${JSON.stringify(name)}] is ${spec}, not a published version`);
      }
    }
  }
  return problems;
}

/**
 * Name prefix of the packages released together from this workspace. The
 * SDK packages share the `@open-ocpp-trace/` scope but are released on
 * their own, so they are not part of the lockstep.
 */
const SCOPE_PREFIX = "@open-ocpp-trace/viewer-";

/**
 * Dependency specifier of a committed package.json that packing replaces
 * with the exact version of the dependency. Other `workspace:` specifiers
 * (`workspace:^`, `workspace:~`) become ranges.
 */
const WORKSPACE_EXACT = "workspace:*";

/**
 * Lists why packages cannot be released together at one version: every
 * manifest must carry the same `version`, and every
 * `@open-ocpp-trace/viewer-*` dependency must be one of these packages,
 * pinned to that exact version (or to `workspace:*`, which packing pins).
 * An empty list means the packages are in lockstep.
 */
export function lockstepProblems(manifests: readonly Manifest[]): string[] {
  if (manifests.length === 0) return ["no package to release"];
  const problems: string[] = [];
  const nameOf = (manifest: Manifest): string => String(manifest.name);
  const names = new Set(manifests.map(nameOf));
  const [first] = manifests;
  const version = first?.version;

  for (const manifest of manifests) {
    if (typeof manifest.version !== "string") {
      problems.push(`${nameOf(manifest)} has no version`);
    } else if (typeof version === "string" && manifest.version !== version) {
      problems.push(
        `${nameOf(manifest)} is at ${manifest.version}, not ${version} like ${nameOf(first ?? {})}`,
      );
    }
    for (const field of DEPENDENCY_FIELDS) {
      const dependencies = manifest[field];
      if (!isObject(dependencies)) continue;
      for (const [name, spec] of Object.entries(dependencies)) {
        if (!name.startsWith(SCOPE_PREFIX)) continue;
        const where = `${nameOf(manifest)} ${field}[${JSON.stringify(name)}]`;
        if (!names.has(name)) {
          problems.push(`${where} is not released with the other packages`);
        } else if (typeof version === "string" && spec !== version && spec !== WORKSPACE_EXACT) {
          problems.push(`${where} is ${String(spec)}, not ${version}`);
        }
      }
    }
  }
  return problems;
}

function readManifest(path: string): Manifest {
  const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isObject(manifest)) throw new Error(`${path} is not a JSON object`);
  return manifest;
}

const tar = (...args: string[]): string => execFileSync("tar", args, { encoding: "utf8" });

function tarballManifest(tarball: string): unknown {
  return JSON.parse(tar("-xzOf", tarball, "package/package.json"));
}

function inspectTarball(tarball: string): string[] {
  const files = tar("-tzf", tarball)
    .split("\n")
    .filter((entry) => entry !== "" && !entry.endsWith("/"))
    .map((entry) => entry.replace(/^package\//, ""));
  const manifest = tarballManifest(tarball);
  if (!isObject(manifest)) return ["package.json is not a JSON object"];
  return inspectPackage(manifest, files);
}

function main(args: readonly string[]): number {
  const [command, path] = args;
  if (command === "lockstep" && path !== undefined) {
    const sources = args.slice(1);
    const manifests: Manifest[] = [];
    const problems: string[] = [];
    for (const source of sources) {
      const manifest: unknown = source.endsWith(".json")
        ? JSON.parse(readFileSync(source, "utf8"))
        : tarballManifest(source);
      if (isObject(manifest)) manifests.push(manifest);
      else problems.push(`${source}: package.json is not a JSON object`);
    }
    problems.push(...lockstepProblems(manifests));
    for (const problem of problems) console.error(`lockstep: ${problem}`);
    if (problems.length > 0) return 1;
    console.log(String(manifests[0]?.version));
    return 0;
  }
  if (command === "strip" && path !== undefined) {
    writeFileSync(path, `${JSON.stringify(stripSourceCondition(readManifest(path)), null, 2)}\n`);
    return 0;
  }
  if (command === "inspect" && path !== undefined) {
    const problems = inspectTarball(path);
    for (const problem of problems) console.error(`${path}: ${problem}`);
    if (problems.length === 0) console.log(`${path}: contents and exports OK`);
    return problems.length === 0 ? 0 : 1;
  }
  console.error(
    "usage: release-manifest.ts strip <package.json> | inspect <tarball> | lockstep <tarball or package.json>...",
  );
  return 2;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
