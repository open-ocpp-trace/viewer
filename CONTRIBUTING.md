# Contributing

Thanks for helping build the Open OCPP Trace viewer. Issues and pull
requests are welcome.

## Where a change belongs

The trace format is owned by
[open-ocpp-trace/specification](https://github.com/open-ocpp-trace/specification),
and reading and writing records by the
[SDK](https://github.com/open-ocpp-trace/sdk). A change to the format or the
codec is proposed there first. This repository depends on
`@open-ocpp-trace/core` and `@open-ocpp-trace/jsonl`; never copy their schema
or JSONL codec here.

## Prerequisites and commands

See [README.md](README.md#prerequisites), including
[GitHub Packages authentication](README.md#github-packages-authentication).

## Checks

Run from the repository root before each commit:

```sh
vp check --fix                  # apply formatting and safe lint fixes
vp check                        # format check, lint and type check
vp test                         # run the tests once
```

and before pushing a branch:

```sh
vp run -r pack                  # build every package into its dist/
vp run smoke                    # pack, install and import from a clean consumer
shellcheck scripts/*.sh         # check the shell scripts
actionlint                      # check the workflows (actionlint 1.7.12)
```

A change to `packages/react/src/styles.css` or to the markup of a control is
also checked in Chromium against host base styles, see
[`scripts/host-styles-check`](scripts/host-styles-check/README.md).

### What CI requires

The workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs when
a pull request touches `packages/`, `apps/`, `examples/`, `scripts/`, the root
configuration, the lockfile or the workflow itself, and on every push to
`main`. Its jobs are:

| Job                                                                                                              | Runs                                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Shellcheck shell scripts`                                                                                       | `shellcheck scripts/*.sh`                                                 |
| `Lint the workflows`                                                                                             | `actionlint` 1.7.12 over every workflow, shellcheck on the `run:` steps   |
| `Check, test and build (Node.js 22)`, `Check, test and build (Node.js 24)`, `Check, test and build (Node.js 26)` | install, `vp check`, `vp test`, `vp run -r pack`, the playground build    |
| `Clean-consumer smoke test (React 18 and 19)`                                                                    | `scripts/smoke-consumer.sh` (`vp run smoke`) on Node.js 22                |
| `ci-result`                                                                                                      | succeeds when every job above succeeded or was skipped by the path filter |

`ci-result` is the only required check. It always reports, so a
documentation-only pull request gets a green check without running the
builds.

## Tests

- **Test first.** For a behaviour change, write the failing test, watch it
  fail, then implement. A bug fix comes with the test that reproduces it.
- **Package boundaries.** `viewer-core` has no React, DOM, Node.js or Bun
  runtime API, CSS, transport or persistence dependency; its `tsconfig.json`
  has no DOM lib and no ambient types, so such an API fails the type check.
  `viewer-react` takes React 18 or 19 as a peer dependency and never bundles
  it; `viewer-standalone` bundles its own React. Nothing under `packages/`
  imports simulator, gateway or DebugKit code.
- **Trace content is untrusted.** Never render it as HTML and never load a
  URL taken from it.

## Commits and pull requests

- **[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).**
  Scopes: `repo`, `ci`, `core`, `react`, `standalone`, `examples`, `docs`.
  For example `feat(core): …`, `fix(react): …`, `ci: …`. Mark a breaking
  change with `!` and a `BREAKING CHANGE:` footer.
- **One concern per pull request.** Link the issue it addresses
  (`Closes #<n>`), and list the checks you ran.
- **Keep documentation in step.** A change to an API, a command or a
  supported version updates the README in the same pull request.

Every pull request is reviewed by a maintainer and merged only with
`ci-result` green.

## Licensing

This repository is licensed under the [Apache License, Version 2.0](LICENSE).
By contributing you agree that your contributions are licensed under the
same terms (inbound = outbound).
