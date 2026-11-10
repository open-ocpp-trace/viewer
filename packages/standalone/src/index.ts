import { hostReactVersion } from "@open-ocpp-trace/viewer-react";

/** Version of the `@open-ocpp-trace/viewer-standalone` package. */
export const VIEWER_STANDALONE_VERSION: string = "0.1.0";

/** Version of the React copy bundled into this package. */
export function bundledReactVersion(): string {
  return hostReactVersion();
}

export { mount } from "./mount.ts";
export type { LiveOptions, MountOnlyOptions, MountOptions, ViewerInstance } from "./mount.ts";
// The types the options and the instance use, so that a host needs neither
// viewer-core nor viewer-react to name them: `dist/index.d.ts` inlines them.
export type {
  ColumnDefinition,
  CorrelationScope,
  EntryUpdate,
  FilterFieldDefinition,
  GapEntry,
  TraceEntry,
  TraceFilter,
  UnparsedEntry,
  Unsubscribe,
  ViewerAdapter,
  ViewerEntry,
  ViewerErrorContext,
  ViewerErrorHandler,
  ViewerSelection,
  ViewerStoreStats,
} from "@open-ocpp-trace/viewer-core";
export type {
  ExportScope,
  InspectorPart,
  JsonlExport,
  PartialViewerStrings,
  ToolbarAction,
  TranslateFunction,
  ViewerActionContext,
  ViewerTheme,
} from "@open-ocpp-trace/viewer-react";
