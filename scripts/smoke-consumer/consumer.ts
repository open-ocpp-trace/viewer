// Type-checked with `tsc --noEmit` in a throwaway project that installed
// the packed tarballs, once per module resolution mode and per React
// version. Reaches types and values through every package entry point, as a
// consumer does, so a tarball whose `types` entry does not resolve fails.

import { createElement, type ReactElement } from "react";

import {
  VIEWER_CORE_VERSION,
  createViewerStore,
  type FilterEngine,
} from "@open-ocpp-trace/viewer-core";
import {
  FilterPanel,
  type FilterPanelProps,
  TraceList,
  type TraceListProps,
  TraceViewer,
  type TraceViewerProps,
  VIEWER_REACT_VERSION,
  hostReactVersion,
  useFilterEngine,
} from "@open-ocpp-trace/viewer-react";
import { VIEWER_STANDALONE_VERSION, bundledReactVersion } from "@open-ocpp-trace/viewer-standalone";

const versions: readonly string[] = [
  VIEWER_CORE_VERSION,
  VIEWER_REACT_VERSION,
  VIEWER_STANDALONE_VERSION,
];
const react: string = hostReactVersion();
const bundled: string = bundledReactVersion();

export const summary: string = [...versions, react, bundled].join(" ");

// The components' declarations reference React's types.
export type ListProps = TraceListProps;
export type PanelProps = FilterPanelProps;
export type ViewerProps = TraceViewerProps;

const viewerProps: TraceViewerProps = {
  store: createViewerStore(),
  defaultSelection: { entryId: null },
  onSelectionChange: (selection) => selection.entryId,
};
export const viewer: ReactElement = createElement(TraceViewer, viewerProps);

export function parts(engine: FilterEngine): ReactElement[] {
  const list: TraceListProps = { engine, selectedId: null, follow: true };
  const panel: FilterPanelProps = { engine, defaultFilter: {} };
  return [createElement(TraceList, list), createElement(FilterPanel, panel)];
}

export const hooks: readonly unknown[] = [useFilterEngine];
