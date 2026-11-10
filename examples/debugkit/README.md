# DebugKit example

Placeholder for deferred work. This example will show a host-side
integration between the viewer and `@ocpp-debugkit/toolkit`, without making
the viewer packages depend on DebugKit or duplicating its analysis engine. It
is tracked by [#11](https://github.com/open-ocpp-trace/viewer/issues/11),
with the work in progress in
[#24](https://github.com/open-ocpp-trace/viewer/pull/24). It does not gate
the 0.1.0 release. DebugKit is only ever imported from this folder, never
from `packages/`.
