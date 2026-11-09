import { version } from "react";

/** Version of the `@open-ocpp-trace/viewer-react` package. */
export const VIEWER_REACT_VERSION: string = "0.0.0";

/** Version of the React copy the host application provides. */
export function hostReactVersion(): string {
  return version;
}

export { EntryInspector } from "./EntryInspector.tsx";
export type { EntryInspectorProps, InspectorPart } from "./EntryInspector.tsx";
export { exportJsonl } from "./export-jsonl.ts";
export type { JsonlExport } from "./export-jsonl.ts";
export { FilterPanel } from "./FilterPanel.tsx";
export type { FilterPanelProps } from "./FilterPanel.tsx";
export { useFilterEngine } from "./hooks.ts";
export { defaultSensitiveKeys } from "./inspect-format.ts";
export { themeTokens } from "./theme.ts";
export type { ColorScheme, ThemeToken, ViewerTheme } from "./theme.ts";
export { TraceList } from "./TraceList.tsx";
export type { TraceListProps } from "./TraceList.tsx";
export { TraceViewer } from "./TraceViewer.tsx";
export type { ExportScope, TraceViewerProps } from "./TraceViewer.tsx";
