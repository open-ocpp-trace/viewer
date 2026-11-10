/** Version of the `@open-ocpp-trace/viewer-core` package. */
export const VIEWER_CORE_VERSION: string = "0.1.0";

export type { Unsubscribe, ViewerAdapter } from "./adapter.ts";
export { createCorrelator } from "./correlation.ts";
export type {
  CallCorrelation,
  CorrelationChange,
  CorrelationScope,
  Correlator,
  CorrelatorOptions,
  EntryCorrelation,
  OrphanCorrelation,
  ResponseCorrelation,
} from "./correlation.ts";
export type {
  EntryDelivery,
  EntryDeliveryRole,
  EntryDeliveryStatus,
  EntryId,
  EntryMetadata,
  EntrySource,
  GapEntry,
  GapReason,
  TraceEntry,
  UnparsedEntry,
  ViewerEntry,
} from "./entry.ts";
export { readEntryFields } from "./entry-fields.ts";
export type { EntryFields } from "./entry-fields.ts";
export type { ColumnDefinition, FilterFieldDefinition, ViewerSelection } from "./extension.ts";
export { createFilterEngine } from "./filter-engine.ts";
export type {
  FilterChange,
  FilterEngine,
  FilterEngineOptions,
  FilterEngineStats,
} from "./filter-engine.ts";
export type { TraceFilter } from "./filter-model.ts";
export { computeStats } from "./filter-stats.ts";
export type { TraceStats } from "./filter-stats.ts";
export { reportViewerError } from "./report-error.ts";
export type { ViewerErrorContext, ViewerErrorHandler } from "./report-error.ts";
export {
  createViewerStore,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_ENTRIES,
  STORE_ID_PREFIX,
} from "./store.ts";
export type {
  ViewerStore,
  ViewerStoreChange,
  ViewerStoreOptions,
  ViewerStoreStats,
} from "./store.ts";
export type { EntryMetadataPatch, EntryUpdate } from "./update.ts";
