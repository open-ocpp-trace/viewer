# Host base styles check

`viewer-react` renders in the host page's light DOM, so the host's base
styles reach the viewer's controls. `check.mjs` loads the built playground
in Chromium with the base layer of a Tailwind CSS v4 + flowbite page
(`host-base.css`, pasted from the published packages) and checks that every
control the viewer styles (filter inputs and checkboxes, toolbar, filter and
inspector buttons, fieldset and legend) computes the same style as without
it, in the light and the dark example, with the host rules layered and
unlayered.

This is the real guard: only a browser cascade shows what a host rule does
to a control. It is not run in CI, which installs no browser. CI runs its
structural counterpart, `packages/react/test/host-base-styles.test.tsx`: each
control the viewer renders must match an `all: revert` rule whose selector
outranks those base rules.

Run it after a change to `packages/react/src/styles.css` or to the markup of
a control:

```sh
vp run @open-ocpp-trace/viewer-playground#build
node scripts/host-styles-check/check.mjs apps/playground/dist \
  <path to a Chromium binary> <path to an installed playwright-core package> \
  <output directory>
```

It exits 0 when every assertion holds and 1 otherwise, printing one `FAIL`
line per assertion, and writes a full-page screenshot and the measured styles
per mode (`none`, `layered`, `unlayered`) to the output directory.

Two differences are expected and not asserted:

- the viewer inherits the host's `line-height`, like any text, so the
  buttons, fieldsets and legends, which inherit their font, may be taller;
- flowbite's `background-color: currentColor !important` on a checked
  checkbox shows in its computed style only: the native checkbox ignores it.
