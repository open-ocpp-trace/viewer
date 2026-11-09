import type { EntryId, EntryMetadata, ViewerEntry } from "./entry.ts";

/**
 * Metadata fields to change on an entry already received. Fields are merged
 * shallowly; `custom` is merged per key and `deliveries` per target (see
 * docs/adr/0001-viewer-entry-contract.md). A key whose value is `undefined`,
 * in `custom` too, is ignored; `null` is a value. A patch cannot remove a
 * field.
 */
export type EntryMetadataPatch = EntryMetadata;

/**
 * One change to the viewer's entries: a new entry, or a metadata patch for an
 * entry already added. An update never touches `record`, `kind`, `id` or
 * `raw`.
 *
 * Each entry has a revision watermark, initially none. An update whose
 * `revision` is lower than or equal to the watermark is stale and ignored;
 * otherwise it applies and its revision becomes the watermark. An update
 * without `revision` always applies and leaves the watermark unchanged.
 * `revision` must be a finite integer >= 0, else the update is dropped and
 * counted. An `add` for an evicted id is a new entry, appended at the end.
 */
export type EntryUpdate =
  | { readonly type: "add"; readonly entry: ViewerEntry }
  | {
      readonly type: "update";
      readonly id: EntryId;
      readonly revision?: number;
      readonly metadata: EntryMetadataPatch;
    };
