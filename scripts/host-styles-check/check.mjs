// Browser check of the viewer-react stylesheet against host base styles.
//
// Serves the built playground, which renders a light and a dark viewer in
// the page's light DOM, and measures the computed style of every control
// the viewer styles three times: with no host stylesheet, with
// host-base.css in `@layer base` (as Tailwind v4 and flowbite publish it)
// and with the same rules unlayered (a Tailwind v3 build, a hand-written
// reset). The host stylesheet is added after the viewer's, so a tie in
// specificity goes to the host. A control must compute the same values
// under host styles as without them.
//
// Usage:
//   node scripts/host-styles-check/check.mjs <playground dist> <chrome binary> \
//     <playwright-core module> <out dir>
// Exit code 0 when every assertion holds, 1 otherwise. Writes
// <out dir>/<mode>.png and <out dir>/<mode>.json per mode.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, chrome, playwrightCore, out] = process.argv.slice(2);
if (out === undefined) {
  console.error("usage: check.mjs <playground dist> <chrome> <playwright-core module> <out dir>");
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(resolve(playwrightCore, "index.mjs")).href);
mkdirSync(out, { recursive: true });

const HOST_CSS = readFileSync(new URL("./host-base.css", import.meta.url), "utf8");
// The flowbite theme values its base rules read.
const HOST_THEME = `:root { --color-brand: #1c64f2; --color-body: #6b7280;
  --color-default: #d1d5db; --color-white: #fff; --color-neutral-quaternary: #e5e7eb; }`;
const MODES = {
  none: null,
  layered: `${HOST_THEME}\n@layer base {\n${HOST_CSS}\n}`,
  unlayered: `${HOST_THEME}\n${HOST_CSS}`,
};

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  try {
    const body = readFileSync(join(dist, path === "/" ? "index.html" : path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "text/html" }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/`;

// The properties a host base style touches on a control.
const PROPS = [
  "appearance",
  "background-color",
  "background-image",
  "color",
  "border-top-width",
  "border-top-style",
  "border-top-color",
  "border-radius",
  "padding-top",
  "padding-left",
  "margin-top",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "box-shadow",
  "letter-spacing",
  "font-feature-settings",
  "width",
  "height",
];

/** Runs in the page: the computed controls of each viewer, keyed by name. */
function measure(props) {
  const pick = (element, extra = {}) => {
    if (element === null) return null;
    const style = getComputedStyle(element);
    const values = Object.fromEntries(props.map((name) => [name, style.getPropertyValue(name)]));
    const box = element.getBoundingClientRect();
    return {
      ...values,
      text: element.textContent,
      boxWidth: Math.round(box.width),
      boxHeight: Math.round(box.height),
      ...extra,
    };
  };
  const labelText = (label) => {
    const text = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    range.selectNodeContents(text);
    const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    return {
      text: text.textContent,
      lines: lines.size,
      width: Math.round(range.getBoundingClientRect().width),
    };
  };
  const focusOutline = (element) => {
    element.focus();
    const style = getComputedStyle(element);
    const result = {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
    element.blur();
    return result;
  };
  return [...document.querySelectorAll(".oot-viewer")].map((viewer) => {
    const search = viewer.querySelector('.oot-filter-field input[type="search"]');
    const text = viewer.querySelector('.oot-filter-field input[type="text"]');
    const checkboxes = viewer.querySelectorAll('.oot-filter-option input[type="checkbox"]');
    const checked = [...checkboxes].find((box) => box.checked) ?? null;
    const unchecked = [...checkboxes].find((box) => !box.checked) ?? null;
    return {
      scheme: viewer.getAttribute("data-oot-color-scheme"),
      search: pick(search, { focus: focusOutline(search) }),
      text: pick(text, { focus: focusOutline(text) }),
      checkbox: pick(unchecked),
      checkboxChecked: pick(checked),
      searchLabel: labelText(search.closest("label")),
      textLabel: labelText(text.closest("label")),
      toolbarButton: pick(viewer.querySelector(".oot-toolbar-button")),
      toolbarPressed: pick(viewer.querySelector('.oot-toolbar-button[aria-pressed="true"]')),
      reset: pick(viewer.querySelector(".oot-filter-reset")),
      clear: pick(viewer.querySelector(".oot-filter-clear")),
      inspectorButton: pick(viewer.querySelector(".oot-inspector__title > button")),
      inspectorLink: pick(viewer.querySelector("button.oot-inspector__link")),
      fieldset: pick(viewer.querySelector(".oot-filter-group")),
      legend: pick(viewer.querySelector(".oot-filter-legend")),
    };
  });
}

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const results = {};
for (const [mode, css] of Object.entries(MODES)) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } });
  await page.goto(url);
  await page.waitForSelector(".oot-viewer .oot-row:not(.oot-row--header)");
  // The plain example's own `.plain-host` rules are not base styles.
  await page.evaluate(() => document.querySelector(".plain-host")?.classList.remove("plain-host"));
  if (css !== null) {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.addStyleTag({ content: css });
  }
  // A selected trace shows the inspector's buttons; a checked kind, a
  // checked checkbox.
  for (const viewer of await page.locator(".oot-viewer").all()) {
    await viewer.locator(".oot-row:not(.oot-row--header)").first().click();
    await viewer.locator('.oot-filter-option input[type="checkbox"]').nth(1).check();
  }
  await page.mouse.click(1, 1);
  results[mode] = await page.evaluate(measure, PROPS);
  writeFileSync(join(out, `${mode}.json`), JSON.stringify(results[mode], null, 2));
  await page.screenshot({ path: join(out, `${mode}.png`), fullPage: true });
  await page.close();
}
await browser.close();
server.close();

const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};
const WHITE = "rgb(255, 255, 255)";
const GEOMETRY = new Set(["line-height", "height", "boxHeight", "width", "boxWidth"]);
for (const [mode, viewers] of Object.entries(results)) {
  viewers.forEach((viewer, index) => {
    const at = `${mode} viewer ${index} (${viewer.scheme})`;
    if (viewer.scheme === "dark") {
      for (const input of ["search", "text", "checkbox"]) {
        expect(viewer[input]["background-color"] !== WHITE, `${at}: ${input} background is white`);
      }
    }
    for (const label of ["searchLabel", "textLabel"]) {
      expect(
        viewer[label].lines === 1,
        `${at}: label "${viewer[label].text}" wraps on ${viewer[label].lines} lines`,
      );
    }
    // The playground passes no onCopy: the inspector's Copy buttons are absent.
    for (const button of ["toolbarButton", "reset", "clear", "inspectorLink"]) {
      const style = viewer[button];
      expect(style !== null, `${at}: no ${button}`);
      if (style === null) continue;
      expect(parseFloat(style["border-top-width"]) > 0, `${at}: ${button} has no border`);
      expect(parseFloat(style["padding-left"]) > 0, `${at}: ${button} has no padding`);
    }
    for (const input of ["search", "text"]) {
      const { focus } = viewer[input];
      expect(
        focus.outlineStyle !== "none" &&
          !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(focus.outlineColor),
        `${at}: ${input} has no visible focus outline (${JSON.stringify(focus)})`,
      );
    }
    if (mode === "none") return;
    // Same computed controls as without host styles. The viewer inherits
    // the host's line-height (preflight sets 1.5 on html) like any text, so
    // the elements that inherit their font (buttons, fieldset, legend) keep
    // their style but not their height, nor the width a flex column or a
    // border-box ancestor gives them.
    const reference = results.none[index];
    for (const [control, style] of Object.entries(viewer)) {
      if (style === null || typeof style !== "object") continue;
      const inheritsFont = !["search", "text", "checkbox", "checkboxChecked"].includes(control);
      for (const [property, value] of Object.entries(style)) {
        if (inheritsFont && GEOMETRY.has(property)) continue;
        // flowbite sets `background-color: currentColor !important` on a
        // checked checkbox; only `!important` would revert it. The native
        // checkbox (appearance: auto) paints without it: same pixels.
        if (control === "checkboxChecked" && property === "background-color") continue;
        const expected = reference[control]?.[property];
        const same = JSON.stringify(value) === JSON.stringify(expected);
        expect(
          same,
          `${at}: ${control} ${property} = ${JSON.stringify(value)}, without host ${JSON.stringify(expected)}`,
        );
      }
    }
  });
}
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(`${failures.length} failure(s)`);
process.exit(failures.length === 0 ? 0 : 1);
