# @open-ocpp-trace/viewer-standalone

The Open OCPP Trace viewer for pages that do not use React. It is the
`<TraceViewer>` of `@open-ocpp-trace/viewer-react`, rendered by its own
bundled React copy inside a shadow root: the host installs neither `react`
nor `react-dom`, and there is no second DOM renderer to keep in sync.

## Usage

The package ships one self-contained ES module, `dist/index.js`. Serve it
with your page and load it as a module:

```html
<div id="trace" style="height: 600px"></div>
<script type="module">
  import { mount } from "/assets/viewer-standalone/index.js";

  const viewer = mount(document.getElementById("trace"), {
    entries: initialEntries, // optional snapshot
    onSelectionChange: (selection, entry) => console.log(selection, entry),
  });

  viewer.ingest(moreEntries); // more entries; ids already held are ignored
  viewer.update([{ type: "update", id: "a", metadata: { tenant: "acme" } }]);
  viewer.setOptions({ theme: { colorScheme: "dark" } });
  viewer.unmount();
</script>
```

From TypeScript, import it the same way (or from the package name with a
bundler); `dist/index.d.ts` declares every type the API uses, including the
entry types (`ViewerEntry`, `EntryUpdate`, `ViewerAdapter`…), and needs no
React types.

## API

`mount(element, options?)` returns a `ViewerInstance`:

| Member             | Effect                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| `ingest(entries)`  | Adds a snapshot or new entries, as `ViewerStore.load`.                                  |
| `update(batch)`    | Applies untrusted updates (`add`, metadata `update`), as `ViewerStore.apply`.           |
| `setOptions(live)` | Merges live options shallowly; `undefined` restores a default; a mount-only key throws. |
| `unmount()`        | Removes the viewer and stops the adapter. Idempotent.                                   |

Mount-only options (a `TypeError` from `setOptions`):

- `entries`: a snapshot ingested before the first render;
- `adapter`: a viewer-core `ViewerAdapter` (`snapshot()` + `subscribe()`),
  connected with `store.connect`. It is the only transport hook: the package
  has no SSE, WebSocket or gateway client built in;
- `maxEntries`, `maxBytes`: the store limits;
- `correlation`: `"conversation"` (default), `"chargePoint"`, `"global"`, or
  `false` for none;
- `nonce`: see [CSP](#csp).

Live options have the meaning of the `<TraceViewer>` props of the same name
(see the viewer-react README): `fields`, `payloadSearch`, `columns`, `filter`,
`defaultFilter`, `onFilterChange`, `selection`, `defaultSelection`,
`onSelectionChange(selection, entry)`, `loading`, `error`, `onCopy`,
`revealSensitive`, `sensitiveKeys`, `onExport`, `theme`, `strings`,
`translate` and `toolbarActions`. Callbacks are read when called: a new
function passed to `setOptions` never re-runs an earlier change.

React-only: `filterControls`, `detailPanels` and `renderPayload` take React
elements, which a non-React host cannot build, so they are not options here.
Payloads show as pretty-printed plain text.

`mount` and `setOptions` throw a `TypeError` naming any key that is neither a
live nor a mount-only option, such as `store`, `correlator`, `className` or a
React-only prop: the viewer's store and correlator are its own.

## Lifecycle

- `mount` renders synchronously: the viewer is in the DOM when it returns.
  `ingest`, `update` and `setOptions` render before returning too. Changes
  from the adapter and from user interaction render asynchronously, as React
  schedules them.
- `mount` appends a `<div data-oot-standalone>` container to `element` and
  attaches an open shadow root to it, so the host's own children stay in
  place. Mounting again in an element that holds a live viewer throws.
- `unmount()` unmounts React, unsubscribes the adapter, disconnects the
  correlator and removes the container. Calling it again does nothing; any
  other method throws once unmounted. The element can be mounted again.
- Each `mount` has its own store, correlator, selection, filter, theme and
  shadow root: several viewers can share a page.

## Styling

The viewer's stylesheet is bundled in the module and applied inside each
shadow root, so it never reaches the page and page rules do not reach the
viewer. The container fills its element (`height: 100%`): give the element
a height.

Theme tokens work as in viewer-react: set `--oot-*` custom properties on the
element or any ancestor (custom properties inherit into the shadow root), or
pass `theme: { colorScheme, tokens }`, which applies to that viewer only.

## CSP

- Scripts: the module is a plain ES module from your origin, so
  `script-src 'self'` is enough. It contains no `eval` or `new Function`, and
  needs no `'unsafe-eval'` or `'unsafe-inline'`.
- Styles: where the browser supports constructable stylesheets, the viewer
  adopts one (`new CSSStyleSheet()`, `replaceSync`, `adoptedStyleSheets`)
  instead of writing a `<style>` element. MDN states that no browser
  currently blocks the CSSOM methods that parse CSS strings
  ([style-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src));
  the CSP draft would gate them behind `'unsafe-eval'`
  ([CSP, style-src](https://w3c.github.io/webappsec-csp/#directive-style-src)).
  Neither names constructable stylesheets.
- Elsewhere the viewer falls back to a `<style>` element, which needs
  `'unsafe-inline'`, a hash or a nonce in `style-src` (same sources): pass
  the page's nonce as the `nonce` option.
- Theme tokens and layout are set through the element's `style` object,
  which MDN says `style-src` does not block.

## Asset paths

`dist/index.js` is the whole asset: no chunks, no CSS file, no fonts, and no
URL resolved at run time. Serve it from any path, subpath or reverse proxy
and import it by that URL.

## No globals

The module assigns no global variable (`window.*`, `globalThis.*`) and
touches no DOM until `mount` is called; import what you use from it.
