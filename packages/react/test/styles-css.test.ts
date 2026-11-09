import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { themeTokens } from "@open-ocpp-trace/viewer-react";

const CSS = readFileSync(join(import.meta.dirname, "../src/styles.css"), "utf8");

interface Parsed {
  /** Style rules: selector list and declarations, `@media` blocks descended. */
  readonly rules: { readonly prelude: string; readonly body: string }[];
  /** The preludes of every at-rule, `@media` included. */
  readonly atRules: string[];
}

/** Splits `text` on `separator` outside parentheses and brackets. */
function splitTop(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (depth === 0 && separator.test(char)) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** A small parser of rule preludes and blocks: enough for a flat stylesheet. */
function parse(css: string, into: Parsed = { rules: [], atRules: [] }): Parsed {
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf("{", at);
    const semicolon = css.indexOf(";", at);
    if (open === -1 && semicolon === -1) break;
    if (semicolon !== -1 && (open === -1 || semicolon < open)) {
      // A statement at-rule (`@import …;`).
      into.atRules.push(css.slice(at, semicolon).trim());
      at = semicolon + 1;
      continue;
    }
    let depth = 1;
    let close = open + 1;
    for (; close < css.length && depth > 0; close++) {
      if (css.charAt(close) === "{") depth++;
      else if (css.charAt(close) === "}") depth--;
    }
    const prelude = css.slice(at, open).trim();
    const body = css.slice(open + 1, close - 1);
    if (prelude.startsWith("@")) {
      into.atRules.push(prelude);
      if (/^@(media|supports)\b/.test(prelude)) parse(body, into);
    } else {
      into.rules.push({ prelude, body });
    }
    at = close;
  }
  return into;
}

function parsed(): Parsed {
  return parse(CSS.replace(/\/\*[\s\S]*?\*\//g, ""));
}

function kebab(token: string): string {
  return token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

describe("styles.css", () => {
  it("parses into rules", () => {
    expect(parsed().rules.length).toBeGreaterThan(20);
  });

  it("scopes the subject of every selector to an oot- class", () => {
    for (const { prelude } of parsed().rules) {
      for (const selector of splitTop(prelude, /,/)) {
        const compounds = splitTop(selector.replace(/\s*([>+~])\s*/g, " "), /\s/);
        const subject = compounds.at(-1) ?? "";
        expect(subject, selector).toMatch(/\.oot-[\w-]/);
        expect(selector, selector).not.toMatch(/:root|\*|(^|[\s>+~(,])(html|body)\b/);
      }
    }
  });

  it("uses no global at-rule", () => {
    for (const prelude of parsed().atRules) {
      expect(prelude, prelude).not.toMatch(/^@(import|font-face|layer|namespace|property)\b/);
      if (prelude.startsWith("@keyframes")) expect(prelude).toMatch(/^@keyframes\s+oot-/);
      else expect(prelude, prelude).toMatch(/^@(media|supports)\b/);
    }
  });

  it("declares private --_oot-* properties only, never a public token", () => {
    for (const { prelude, body } of parsed().rules) {
      for (const [, name] of body.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) {
        expect(name, `${prelude} declares ${name}`).toMatch(/^--_oot-/);
      }
    }
  });

  it("reads exactly the documented theme tokens", () => {
    const read = new Set([...CSS.matchAll(/var\(\s*(--oot-[\w-]+)/g)].map(([, name]) => name));
    expect(read.size).toBeGreaterThan(0);
    expect(read).toEqual(new Set(themeTokens.map((token) => `--oot-${kebab(token)}`)));
  });

  it("keys dark defaults on the viewer root, the media query only for auto", () => {
    const { rules } = parsed();
    const dark = rules.filter(({ body }) => /--_oot-[\w-]+\s*:/.test(body));
    expect(dark.length).toBeGreaterThan(0);
    for (const { prelude } of dark) {
      expect(prelude).toMatch(/^\.oot-viewer\[data-oot-color-scheme="(dark|auto)"\]$/);
    }
    for (const scheme of ["light", "dark", "auto"]) {
      const rule = rules.find(
        ({ prelude, body }) =>
          prelude === `.oot-viewer[data-oot-color-scheme="${scheme}"]` &&
          /color-scheme\s*:/.test(body),
      );
      expect(rule, scheme).toBeDefined();
    }
    const media = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\}\s*\}/.exec(CSS);
    expect(media?.[1]).toMatch(/^\s*\.oot-viewer\[data-oot-color-scheme="auto"\]\s*\{/);
  });
});
