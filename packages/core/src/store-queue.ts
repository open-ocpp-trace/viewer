import type { ViewerEntry } from "./entry.ts";

/** One held entry, listed or pending, and what the store caches about it. */
export interface Slot {
  /** The checked id the entry is indexed under; never re-read from the entry. */
  readonly id: string;
  /** Replaced by each update that changes the metadata. */
  entry: ViewerEntry;
  /**
   * Position in the listing sequence, assigned when the entry is listed
   * (the listed index is `seq` minus the sequence of the oldest listed
   * entry); -1 while the entry is pending.
   */
  seq: number;
  /** Cached weight of every field but the metadata, computed once at add. */
  readonly coreBytes: number;
  /** Cached weight of the metadata, recomputed when it changes. */
  metadataBytes: number;
  /** Revision watermark (rule 1), none until a revised update applies. */
  revision: number | undefined;
}

/** The backing array is compacted once this many removed slots precede the head. */
const COMPACT_THRESHOLD = 1024;

/**
 * A FIFO of slots and the bytes they retain, removed from the front in O(1)
 * amortized: removed slots are cleared and the backing array is compacted
 * occasionally, never shifted per removal.
 */
export interface SlotQueue {
  readonly length: number;
  readonly bytes: number;
  /** Length of the backing array (tests: it stays bounded). */
  readonly backingLength: number;
  at(position: number): Slot | undefined;
  push(slot: Slot): void;
  /** Removes and returns the oldest slot. */
  shift(): Slot | undefined;
  /** Accounts for a slot whose metadata weight changed by `delta`. */
  reweigh(delta: number): void;
  /**
   * Whether the queue holds more than `maxEntries` slots, or more than
   * `maxBytes` bytes with more than one slot (an oversized slot is kept alone).
   */
  overLimits(maxEntries: number, maxBytes: number): boolean;
  /** Removes every slot and returns them, oldest first. */
  drain(): Slot[];
}

export function createSlotQueue(): SlotQueue {
  let slots: (Slot | undefined)[] = [];
  let head = 0;
  let bytes = 0;
  const length = (): number => slots.length - head;
  return {
    get length() {
      return length();
    },
    get bytes() {
      return bytes;
    },
    get backingLength() {
      return slots.length;
    },
    at(position) {
      return slots[head + position];
    },
    push(slot) {
      slots.push(slot);
      bytes += slot.coreBytes + slot.metadataBytes;
    },
    shift() {
      const slot = slots[head];
      if (slot === undefined) return undefined;
      slots[head++] = undefined;
      bytes -= slot.coreBytes + slot.metadataBytes;
      if (head >= COMPACT_THRESHOLD && head * 2 >= slots.length) {
        slots = slots.slice(head);
        head = 0;
      }
      return slot;
    },
    reweigh(delta) {
      bytes += delta;
    },
    overLimits(maxEntries, maxBytes) {
      return length() > maxEntries || (bytes > maxBytes && length() > 1);
    },
    drain() {
      const drained = slots.slice(head) as Slot[];
      slots = [];
      head = 0;
      bytes = 0;
      return drained;
    },
  };
}
