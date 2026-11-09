// One constructable sheet per document and css: a sheet can only be adopted
// by the document it was constructed in, and it is never modified once built.
const sheets = new WeakMap<Document, Map<string, CSSStyleSheet>>();

function sharedSheet(document: Document, css: string): CSSStyleSheet | undefined {
  const cached = sheets.get(document)?.get(css);
  if (cached !== undefined) return cached;
  const Sheet = document.defaultView?.CSSStyleSheet;
  if (typeof Sheet !== "function" || typeof Sheet.prototype.replaceSync !== "function") {
    return undefined;
  }
  const sheet = new Sheet();
  sheet.replaceSync(css);
  const byCss = sheets.get(document) ?? new Map<string, CSSStyleSheet>();
  byCss.set(css, sheet);
  sheets.set(document, byCss);
  return sheet;
}

/**
 * Applies `css` to `root`: as an adopted constructable stylesheet when the
 * browser supports them (no `style-src 'unsafe-inline'` needed), otherwise as
 * a `<style>` element, which carries `nonce` when given.
 */
export function attachStyles(root: ShadowRoot, css: string, nonce: string | undefined): void {
  const sheet = Array.isArray(root.adoptedStyleSheets)
    ? sharedSheet(root.ownerDocument, css)
    : undefined;
  if (sheet !== undefined) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  }
  const style = root.ownerDocument.createElement("style");
  if (nonce !== undefined) style.nonce = nonce;
  style.textContent = css;
  root.append(style);
}
