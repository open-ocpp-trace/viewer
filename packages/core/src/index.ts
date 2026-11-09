import type { TraceRecord } from "@open-ocpp-trace/core";

/** Version of the `@open-ocpp-trace/viewer-core` package. */
export const VIEWER_CORE_VERSION: string = "0.0.0";

// Placeholder until the entry contract (#2) builds on the SDK model: it keeps
// the dependency on `@open-ocpp-trace/core` type-checked without re-exporting
// SDK types.
// oxlint-disable-next-line no-unused-vars
type SdkTraceRecord = TraceRecord;
