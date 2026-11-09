import type { EntryId, EntryMetadata, ViewerEntry } from "./entry.ts";

/**
 * Metadata fields to change on an entry already received. Fields are merged
 * shallowly; `custom` is merged per key and `deliveries` per target (see
 * docs/adr/0001-viewer-entry-contract.md). A patch cannot remove a field.
 */
export type EntryMetadataPatch = EntryMetadata;

/**
 * One change to the viewer's entries: a new entry, or a metadata patch for an
 * entry already added. An update never touches `record`, `kind`, `id` or
 * `raw`. When `revision` is present, an update whose revision is not greater
 * than the last one applied to that entry is stale and ignored; without it,
 * arrival order wins.
 */
export type EntryUpdate =
  | { readonly type: "add"; readonly entry: ViewerEntry }
  | {
      readonly type: "update";
      readonly id: EntryId;
      readonly revision?: number;
      readonly metadata: EntryMetadataPatch;
    };
