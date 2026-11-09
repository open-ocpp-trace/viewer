import type { CSSProperties } from "react";

/** The colors of the viewer: `"auto"` follows `prefers-color-scheme`. */
export type ColorScheme = "light" | "dark" | "auto";

/**
 * The documented theme tokens, in camelCase. Each one is the CSS custom
 * property `--oot-<kebab-case>` the stylesheet reads (`borderColor` is
 * `--oot-border-color`), which a host may also set on any ancestor.
 */
export const themeTokens = [
  "alertColor",
  "background",
  "borderColor",
  "codeMaxHeight",
  "color",
  "detailWidth",
  "focusColor",
  "fontFamily",
  "fontSize",
  "gapBackground",
  "headerBackground",
  "listMinWidth",
  "selectedBackground",
  "selectedColor",
  "unparsedBackground",
] as const satisfies readonly string[];

/** A documented theme token; see {@link themeTokens}. */
export type ThemeToken = (typeof themeTokens)[number];

/** The theme of a viewer, applied to its root element only. */
export interface ViewerTheme {
  /** Default "auto": follows `prefers-color-scheme`. */
  readonly colorScheme?: ColorScheme;
  /** Overrides of the documented tokens, as CSS values. */
  readonly tokens?: { readonly [K in ThemeToken]?: string };
}

function kebab(token: string): string {
  return token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** The inline custom properties of `theme`'s tokens, merged into `style`. */
export function themeStyle(theme: ViewerTheme | undefined, style: CSSProperties): CSSProperties {
  const tokens = theme?.tokens;
  if (tokens === undefined) return style;
  const properties: Record<string, string> = {};
  for (const token of themeTokens) {
    const value = tokens[token];
    if (typeof value === "string") properties[`--oot-${kebab(token)}`] = value;
  }
  return { ...style, ...properties } as CSSProperties;
}
