// Type-checked by scripts/smoke-consumer.sh in a project that installs only
// the viewer-standalone tarball: no react, react-dom or @types/react, and
// `skipLibCheck: false`, so `dist/index.d.ts` must stand on its own.

import {
  mount,
  type EntryUpdate,
  type LiveOptions,
  type ViewerAdapter,
  type ViewerEntry,
  type ViewerInstance,
  type ViewerSelection,
} from "@open-ocpp-trace/viewer-standalone";

const entry: ViewerEntry = {
  kind: "trace",
  id: "boot",
  record: {
    schemaVersion: "1.1",
    timestamp: "2026-11-09T08:00:00.000Z",
    transport: "json",
    direction: "cp-to-csms",
    ocppVersion: "1.6",
    chargePointId: "CP-1",
    messageType: "CALL",
    messageId: "m-1",
    action: "BootNotification",
    payload: { chargePointVendor: "Acme", chargePointModel: "AC-22" },
  },
};

const tag: EntryUpdate = { type: "update", id: "boot", metadata: { tenant: "acme" } };

const adapter: ViewerAdapter = {
  snapshot: () => [entry],
  subscribe: () => () => {},
};

const live: LiveOptions = {
  theme: { colorScheme: "dark", tokens: { focusColor: "#e8a33d" } },
  strings: { empty: "Aucune entrée" },
  onSelectionChange: (selection: ViewerSelection, selected: ViewerEntry | undefined) => {
    console.log(selection.entryId, selected?.kind);
  },
};

export function show(element: HTMLElement): ViewerInstance {
  const viewer = mount(element, { adapter, nonce: "abc", ...live });
  viewer.ingest([entry]);
  viewer.update([tag]);
  viewer.setOptions({ loading: false, theme: undefined });
  return viewer;
}

// @ts-expect-error A mount-only option is not a live option.
const mountOnly: LiveOptions = { adapter };
console.log(mountOnly);
