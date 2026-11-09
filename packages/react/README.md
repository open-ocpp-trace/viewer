# @open-ocpp-trace/viewer-react

## Theming

Import the stylesheet once: `import "@open-ocpp-trace/viewer-react/styles.css";`. Every rule is
scoped to an `oot-` class; the file has no global reset, `:root`, element or `@font-face` rule.

`<TraceViewer theme={…}>` themes one viewer, on its root element only:

```tsx
<TraceViewer
  store={store}
  theme={{ colorScheme: "dark", tokens: { background: "#10151c", borderColor: "#2a3442" } }}
/>
```

- `colorScheme`: `"light"`, `"dark"` or `"auto"` (default, follows `prefers-color-scheme`). It is set as
  `data-oot-color-scheme` on the root, which sets the CSS `color-scheme`: the default colors are system colors
  (`Canvas`, `CanvasText`, `Highlight`) that follow it.
- `tokens`: overrides of the tokens below, as CSS values. Each one is set inline on the root as its custom
  property (`borderColor` → `--oot-border-color`). Two viewers in one page keep their own tokens.

A host may set the same `--oot-*` properties on any ancestor instead, in its own CSS; the stylesheet only reads
them and never declares them, so a host value always wins over the defaults, in both color schemes. Tokens given
through the `theme` prop win over ancestor values. `themeTokens` lists the token names.

| Token                | CSS property                | Default                     |
| -------------------- | --------------------------- | --------------------------- |
| `alertColor`         | `--oot-alert-color`         | dark red, light red on dark |
| `background`         | `--oot-background`          | `Canvas`                    |
| `borderColor`        | `--oot-border-color`        | `rgb(128 128 128 / 30%)`    |
| `codeMaxHeight`      | `--oot-code-max-height`     | `24em`                      |
| `color`              | `--oot-color`               | `CanvasText`                |
| `detailWidth`        | `--oot-detail-width`        | `28em`                      |
| `focusColor`         | `--oot-focus-color`         | `Highlight`                 |
| `fontFamily`         | `--oot-font-family`         | `ui-monospace, monospace`   |
| `fontSize`           | `--oot-font-size`           | `0.8125rem`                 |
| `gapBackground`      | `--oot-gap-background`      | translucent amber           |
| `headerBackground`   | `--oot-header-background`   | `rgb(128 128 128 / 12%)`    |
| `listMinWidth`       | `--oot-list-min-width`      | `16em`                      |
| `selectedBackground` | `--oot-selected-background` | `Highlight`                 |
| `selectedColor`      | `--oot-selected-color`      | `HighlightText`             |
| `unparsedBackground` | `--oot-unparsed-background` | translucent red             |

A standalone `<TraceList>`, `<FilterPanel>` or `<EntryInspector>` has no viewer root: it reads the same tokens
from its ancestors and follows the page's color scheme.

## Localization

Every text, accessible label and status the components show comes from `defaultStrings` (English). A host
replaces them with two props, on `<TraceViewer>` (which passes them to everything it renders) or on a standalone
`<TraceList>`, `<FilterPanel>` or `<EntryInspector>`:

- `strings`: a partial copy of `defaultStrings` (`PartialViewerStrings`): any subset of the leaves, nested
  objects partial, each leaf a string or a function of the same signature.

  ```tsx
  const fr = { toolbar: { pause: "Pause", pending: (count: number) => `${count} en attente` } };
  <TraceViewer store={store} strings={fr} />;
  ```

- `translate(key, params)` (`TranslateFunction`): the key is the dotted path of the leaf in `defaultStrings`
  (`"toolbar.exported"`, `"inspector.fields.messageId"`, `"columns.action"`, `"filter.kindNames.gap"`, `"gap"`),
  and `params` the named arguments of a function leaf (`{}` for a plain string). Returning `undefined` keeps the
  next source.

Per leaf, the first that applies wins: a string returned by `translate`, then the `strings` leaf, then the default.
The strings are resolved again only when the identity of `strings` or `translate` changes: memoize both (a new
object or function on every render resolves every string on every render). A `translate` that throws is
reported (`reportError`, else `console.error`) and the leaf falls back; the viewer stays mounted.

Function leaves and their named parameters:

| Key                   | Parameters                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `toolbar.pending`     | `count`                                                                                            |
| `toolbar.exported`    | `count`, `skipped`                                                                                 |
| `gap`                 | `missedCount`, `reason` (both may be `null`)                                                       |
| `inspector.totalSize` | `chars`                                                                                            |
| `inspector.copy`      | `block`                                                                                            |
| `inspector.candidate` | `position`                                                                                         |
| `inspector.source`    | `id`, `label` (may be `null`)                                                                      |
| `inspector.delivery`  | `target`, `role`, `status`, `reason`, `updatedAt` (`role`, `reason` and `updatedAt` may be `null`) |
| `filter.invalid`      | `reason`                                                                                           |
| `filter.clearGroup`   | `legend`                                                                                           |
| `filter.option`       | `value`, `count`                                                                                   |

`filter.invalid`'s `reason` is the filter engine's own message, in English. Host strings (the labels of host
columns, the `error` prop) are shown as given.

A bridge to i18next, without any dependency of the viewer on it:

```ts
const translate: TranslateFunction = (key, params) =>
  i18n.exists(`ocppViewer.${key}`) ? i18n.t(`ocppViewer.${key}`, params) : undefined;
```
