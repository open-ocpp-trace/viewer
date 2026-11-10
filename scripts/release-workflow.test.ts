// Guards of .github/workflows/release.yml that a reviewer could miss in a
// diff. The workflow is read as text, line by line: a top-level key starts
// at column 0, a job at column 2 under `jobs:`, and a `run:` body is either
// the rest of its line or the block of lines indented deeper than its key.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

const WORKFLOW = fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url));

const PACKAGES = ["core", "react", "standalone"] as const;

function readWorkflow(): readonly string[] {
  return readFileSync(WORKFLOW, "utf8").split("\n");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

/** The lines of the block under `key:` at `indent`, between `from` and `to`. */
function blockOf(
  lines: readonly string[],
  key: string,
  indent: number,
  from = 0,
  to = lines.length,
): readonly string[] {
  const start = lines.findIndex(
    (line, index) => index >= from && index < to && line === `${" ".repeat(indent)}${key}:`,
  );
  if (start === -1) return [];
  const block: string[] = [];
  for (let index = start + 1; index < to; index += 1) {
    const line = lines[index] ?? "";
    if (!isBlankOrComment(line) && indentOf(line) <= indent) break;
    block.push(line);
  }
  // The blank lines and comments before the next key belong to it.
  while (block.length > 0 && isBlankOrComment(block.at(-1) ?? "")) block.pop();
  return block;
}

/** The keys directly under a block whose children are at `indent`. */
function keysOf(block: readonly string[], indent: number): readonly string[] {
  return block
    .filter((line) => !isBlankOrComment(line) && indentOf(line) === indent)
    .map((line) => line.trim().replace(/:.*$/, ""));
}

/** Each job's lines, by job id. */
function jobsOf(lines: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const jobs = new Map<string, readonly string[]>();
  for (const id of keysOf(blockOf(lines, "jobs", 0), 2)) {
    jobs.set(id, blockOf(lines, id, 2, lines.indexOf("jobs:")));
  }
  return jobs;
}

/** The shell text of every `run:` step, without its comments. */
function runBodies(lines: readonly string[]): readonly string[] {
  const bodies: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (match === null) return;
    const keyIndent = (match[1] ?? "").length + (line.trimStart().startsWith("- ") ? 2 : 0);
    const inline = match[2] ?? "";
    if (inline !== "|" && inline !== ">" && inline !== "") {
      bodies.push(inline);
      return;
    }
    const body: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const bodyLine = lines[next] ?? "";
      if (bodyLine.trim() !== "" && indentOf(bodyLine) <= keyIndent) break;
      if (!bodyLine.trim().startsWith("#")) body.push(bodyLine);
    }
    bodies.push(body.join("\n"));
  });
  return bodies;
}

/** The lines of the step named `name`, from its `- name:` line on. */
function stepOf(lines: readonly string[], name: string): readonly string[] {
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) return [];
  const indent = indentOf(lines[start] ?? "");
  const step = [lines[start] ?? ""];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!isBlankOrComment(line) && indentOf(line) <= indent) break;
    step.push(line);
  }
  return step;
}

/** The trimmed, non-blank lines of a shell body. */
function shellLines(body: string): readonly string[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function text(lines: readonly string[]): string {
  return lines.join("\n");
}

describe("release workflow", () => {
  it("is started by hand only, as a dry run by default", () => {
    const lines = readWorkflow();
    const on = blockOf(lines, "on", 0);
    expect(keysOf(on, 2)).toEqual(["workflow_dispatch"]);
    const dryRun = blockOf(on, "dry-run", 6);
    expect(dryRun.map((line) => line.trim())).toEqual(
      expect.arrayContaining(["type: boolean", "default: true"]),
    );
  });

  it("reads contents only by default and never requests an OIDC token", () => {
    const lines = readWorkflow();
    expect(blockOf(lines, "permissions", 0).map((line) => line.trim())).toEqual(["contents: read"]);
    expect(text(lines)).not.toMatch(/id-token:/);
  });

  it("runs verify, then publish, then tag", () => {
    const jobs = jobsOf(readWorkflow());
    expect([...jobs.keys()]).toEqual(["verify", "publish", "tag"]);
    expect(text(jobs.get("publish") ?? [])).toMatch(/^ {4}needs: verify$/m);
    expect(text(jobs.get("tag") ?? [])).toMatch(/^ {4}needs: \[verify, publish\]$/m);
  });

  it("grants packages: write to the publish job only, in the github-packages environment", () => {
    const jobs = jobsOf(readWorkflow());
    for (const [id, job] of jobs) {
      const writes = /^\s+packages: write$/m.test(text(job));
      expect({ id, writes }).toEqual({ id, writes: id === "publish" });
    }
    expect(text(jobs.get("publish") ?? [])).toMatch(/^ {4}environment: github-packages$/m);
    expect(text(jobs.get("verify") ?? [])).toMatch(/^ {6}packages: read$/m);
  });

  it("grants contents: write to the tag job only, which skips dry runs", () => {
    const jobs = jobsOf(readWorkflow());
    for (const [id, job] of jobs) {
      const writes = /^\s+contents: write$/m.test(text(job));
      expect({ id, writes }).toEqual({ id, writes: id === "tag" });
    }
    expect(text(jobs.get("tag") ?? [])).toMatch(/^ {4}if: \$\{\{ !inputs\.dry-run \}\}$/m);
  });

  it("pins every action to a commit SHA", () => {
    const uses = readWorkflow().filter((line) => /^\s*(?:- )?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d/);
    }
  });

  it("checks out without persisting credentials and uses no build cache", () => {
    const lines = readWorkflow();
    const checkouts = lines.filter((line) => line.includes("uses: actions/checkout@")).length;
    const persist = lines.filter((line) => line.trim() === "persist-credentials: false").length;
    expect(checkouts).toBeGreaterThan(0);
    expect(persist).toBe(checkouts);
    expect(text(lines)).not.toMatch(/^\s*cache: true$/m);
    expect(text(lines)).not.toMatch(/uses: actions\/cache/);
    expect(text(lines)).toMatch(/^\s+cache: false$/m);
  });

  it("interpolates no expression into a run step", () => {
    const bodies = runBodies(readWorkflow());
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toContain("${{");
  });

  it("publishes the verified tarballs without --provenance, core first", () => {
    const jobs = jobsOf(readWorkflow());
    const publish = runBodies(jobs.get("publish") ?? []).join("\n");
    expect(runBodies(readWorkflow()).join("\n")).not.toContain("--provenance");
    expect(publish).toContain(`for package in ${PACKAGES.join(" ")}; do`);
    expect(publish).toMatch(/npm publish "\$tarball" --registry "\$REGISTRY_URL" --dry-run/);
    expect(text(jobs.get("publish") ?? [])).toMatch(/uses: actions\/download-artifact@/);
    expect(text(jobs.get("publish") ?? [])).not.toMatch(/uses: actions\/checkout@/);
  });

  it("refuses a real release from another ref than main, at 0.0.0, tagged or published", () => {
    const jobs = jobsOf(readWorkflow());
    const verify = runBodies(jobs.get("verify") ?? []).join("\n");
    const publish = runBodies(jobs.get("publish") ?? []).join("\n");
    for (const body of [verify, publish]) {
      expect(body).toContain('[ "$DRY_RUN" != true ] && [ "$REF" != refs/heads/main ]');
    }
    expect(verify).toContain('[ "$DRY_RUN" != true ] && [ "$VERSION" = 0.0.0 ]');
    expect(verify).toContain('git ls-remote --exit-code --tags "$REPOSITORY_URL" "refs/tags/$TAG"');
    expect(verify).toContain(`for package in ${PACKAGES.join(" ")}; do`);
    expect(verify).toContain("grep -q 'code E404'");
    expect(publish).toContain("grep -q 'code E404'");
  });

  it("fails the job on every error it reports", () => {
    const errors = runBodies(readWorkflow()).flatMap((body) => {
      const lines = shellLines(body);
      return lines.flatMap((line, index) =>
        line.includes("::error::") ? [{ error: line, then: lines[index + 1] }] : [],
      );
    });
    expect(errors.length).toBeGreaterThan(0);
    for (const { error, then } of errors) {
      expect({ error, then }).toEqual({
        error,
        then: expect.stringMatching(/^(status=1|exit 1)$/),
      });
    }
  });

  it("checks every condition of a release before failing on any", () => {
    const step = stepOf(readWorkflow(), "Check that this version is not released yet");
    const lines = shellLines(runBodies(step).join("\n"));
    expect(lines.at(0)).toBe("status=0");
    expect(lines.at(-1)).toBe('exit "$status"');
  });

  it("packs, verifies, then checks the lockstep of the three packages", () => {
    const verify = runBodies(jobsOf(readWorkflow()).get("verify") ?? []).join("\n");
    const pack = verify.indexOf(
      `scripts/pack-release.sh "$RUNNER_TEMP/release" ${PACKAGES.join(" ")}`,
    );
    const check = verify.indexOf("sh scripts/verify-packages.sh");
    const lockstep = verify.indexOf("node scripts/release-manifest.ts lockstep");
    expect(pack).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(pack);
    expect(lockstep).toBeGreaterThan(check);
    expect(verify).toContain('echo "tag=v$version"');
  });
});
