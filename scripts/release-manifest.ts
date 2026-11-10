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
// argument ending in `.json`), to check the versions before packing; only
// there may a viewer dependency still be `workspace:*`. The arguments must
// name every package under packages/, each once. It also checks that the
// `VIEWER_*_VERSION` literal in each package's
// src/index.ts, found in this workspace through `repository.directory`,
// is the shared version.
// `strip` is only ever run on the copy extracted from a tarball, never on
// a committed package.json. It drops the development-only export
// condition and the `prepublishOnly` guard that stops a publish from a
// package directory; `inspect` rejects a tarball that still has either.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Development-only export condition that points at `src/` (see vite.config.ts). */
export const SOURCE_CONDITION = "@open-ocpp-trace/viewer-source";

/**
 * Licenses of the third-party code a package bundles into `dist/`, which
 * the package must ship with that code.
 */
export const THIRD_PARTY_NOTICES = "THIRD_PARTY_NOTICES.md";

/** Packages whose `dist/` bundles third-party code (see their vite.config.ts). */
const BUNDLING_PACKAGES: readonly string[] = ["@open-ocpp-trace/viewer-standalone"];

/** Files a published package may contain besides `dist/`. */
const TOP_LEVEL_FILES: readonly string[] = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  THIRD_PARTY_NOTICES,
];

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

/**
 * Script of the committed package.json files that fails `npm publish` and
 * `bun publish` run in a package directory, whose manifest still points at
 * `src/` and ships no LICENSE. Only the tarballs written by
 * scripts/pack-release.sh are published, and they no longer carry it.
 */
export const PUBLISH_GUARD = "prepublishOnly";

/**
 * Returns the published form of a workspace `manifest`: without the source
 * export condition and without the publish guard. Other fields, other
 * scripts included, are kept as they are.
 */
export function toPublishedManifest<T extends Manifest>(manifest: T): T {
  const published: Manifest = stripSourceCondition(manifest);
  const scripts = published.scripts;
  if (isObject(scripts) && PUBLISH_GUARD in scripts) {
    const { [PUBLISH_GUARD]: _guard, ...rest } = scripts;
    published.scripts = rest;
  }
  return published as T;
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

  const required = ["LICENSE", "README.md", "CHANGELOG.md"];
  if (BUNDLING_PACKAGES.includes(String(manifest.name))) required.push(THIRD_PARTY_NOTICES);
  for (const file of required) {
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

  const scripts = manifest.scripts;
  if (isObject(scripts) && PUBLISH_GUARD in scripts) {
    problems.push(
      `scripts.${PUBLISH_GUARD} is the workspace publish guard, which refuses this tarball too`,
    );
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

/** How {@link lockstepProblems} reads its manifests. */
export interface LockstepOptions {
  /**
   * The manifests are the committed package.json files, where
   * `workspace:*` is expected because packing pins it. In packed manifests
   * (the default) a leftover `workspace:*` means packing failed.
   */
  readonly committed?: boolean;
}

/**
 * Lists why packages cannot be released together at one version: every
 * manifest must carry the same `version`, and every
 * `@open-ocpp-trace/viewer-*` dependency must be one of these packages,
 * pinned to that exact version (or, in committed manifests only, to
 * `workspace:*`, which packing pins). An empty list means the packages
 * are in lockstep.
 */
export function lockstepProblems(
  manifests: readonly Manifest[],
  options: LockstepOptions = {},
): string[] {
  const acceptsWorkspaceExact = options.committed === true;
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
        } else if (
          typeof version === "string" &&
          spec !== version &&
          !(acceptsWorkspaceExact && spec === WORKSPACE_EXACT)
        ) {
          problems.push(`${where} is ${String(spec)}, not ${version}`);
        }
      }
    }
  }
  return problems;
}

/**
 * Lists why the packages `given` (by name) are not exactly the workspace
 * packages `expected`: a release ships every one of them, once. An empty
 * list means the set is complete.
 */
export function releaseSetProblems(
  given: readonly string[],
  expected: readonly string[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const name of given) {
    if (seen.has(name)) problems.push(`${name} is given more than once`);
    seen.add(name);
  }
  for (const name of expected) {
    if (!seen.has(name)) problems.push(`${name} is a workspace package missing from the release`);
  }
  for (const name of seen) {
    if (!expected.includes(name)) problems.push(`${name} is not a workspace package`);
  }
  return problems;
}

/** Directory of this workspace, the parent of scripts/. */
function workspaceDirectory(): string {
  return resolve(fileURLToPath(import.meta.url), "..", "..");
}

/** Names of the packages under packages/ in this workspace. */
function workspacePackageNames(): string[] {
  const packages = resolve(workspaceDirectory(), "packages");
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(packages, entry.name, "package.json"))
    .filter((path) => existsSync(path))
    .map((path) => String(readManifest(path).name));
}

/**
 * Name of the constant through which a package exposes its own version:
 * `@open-ocpp-trace/viewer-core` declares `VIEWER_CORE_VERSION`.
 */
function versionConstantName(manifest: Manifest): string {
  const suffix = String(manifest.name).slice(SCOPE_PREFIX.length);
  return `VIEWER_${suffix.toUpperCase().replace(/-/g, "_")}_VERSION`;
}

/**
 * Lists why the `src/index.ts` of a package (its text in `source`) does not
 * expose `version`: it must declare its `VIEWER_*_VERSION` constant as a
 * string literal equal to the shared version. An empty list means it does.
 */
export function versionConstantProblems(
  manifest: Manifest,
  version: string,
  source: string,
): string[] {
  const constant = versionConstantName(manifest);
  const declaration = new RegExp(`export const ${constant}(?:: string)? = "([^"]*)";`);
  const literal = declaration.exec(source)?.[1];
  const name = String(manifest.name);
  if (literal === undefined) {
    return [`${name} src/index.ts declares no ${constant} string literal`];
  }
  return literal === version ? [] : [`${name} ${constant} is ${literal}, not ${version}`];
}

/**
 * Checks the `VIEWER_*_VERSION` constant of each package against `version`,
 * reading `src/index.ts` from the workspace directory named by the
 * manifest's `repository.directory`.
 */
function versionConstantsInWorkspace(manifests: readonly Manifest[], version: string): string[] {
  const workspace = workspaceDirectory();
  const problems: string[] = [];
  for (const manifest of manifests) {
    const repository = manifest.repository;
    const directory = isObject(repository) ? repository.directory : undefined;
    if (typeof directory !== "string") {
      problems.push(`${String(manifest.name)} has no repository.directory`);
      continue;
    }
    const path = resolve(workspace, directory, "src", "index.ts");
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      problems.push(`${String(manifest.name)} has no ${path}`);
      continue;
    }
    problems.push(...versionConstantProblems(manifest, version, source));
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
    problems.push(
      ...releaseSetProblems(
        manifests.map((manifest) => String(manifest.name)),
        workspacePackageNames(),
      ),
    );
    // `workspace:*` is only expected before packing.
    const committed = sources.every((source) => source.endsWith(".json"));
    problems.push(...lockstepProblems(manifests, { committed }));
    const version = manifests[0]?.version;
    if (typeof version === "string") {
      problems.push(...versionConstantsInWorkspace(manifests, version));
    }
    for (const problem of problems) console.error(`lockstep: ${problem}`);
    if (problems.length > 0) return 1;
    console.log(String(manifests[0]?.version));
    return 0;
  }
  if (command === "strip" && path !== undefined) {
    writeFileSync(path, `${JSON.stringify(toPublishedManifest(readManifest(path)), null, 2)}\n`);
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
