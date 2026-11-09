// Two viewers on one plain page, from the built viewer-standalone asset.
// The page has no React: the asset bundles its own copy.

import {
  bundledReactVersion,
  mount,
  VIEWER_STANDALONE_VERSION,
  type MountOptions,
  type ViewerInstance,
} from "@open-ocpp-trace/viewer-standalone";

import "./page.css";
import { heartbeat, memoryAdapter, SNAPSHOT, TENANT_UPDATE } from "./sample.ts";

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`the page has no #${id} element`);
  return element as T;
}

const leftHost = byId("left-viewer");
const rightHost = byId("right-viewer");
const log = byId<HTMLOListElement>("events");
const addButton = byId<HTMLButtonElement>("add");
const updateButton = byId<HTMLButtonElement>("update");
const toggleButton = byId<HTMLButtonElement>("toggle");
const darkCheckbox = byId<HTMLInputElement>("dark");

byId("version").textContent =
  `viewer-standalone ${VIEWER_STANDALONE_VERSION}, bundling React ${bundledReactVersion()}`;

/** Appends a line to the host's event log; trace content is set as text only. */
function report(viewer: string, message: string): void {
  const item = document.createElement("li");
  item.textContent = `${viewer}: ${message}`;
  log.prepend(item);
}

function callbacks(viewer: string): MountOptions {
  return {
    onSelectionChange: (selection, entry) =>
      report(viewer, `selected ${selection.entryId ?? "nothing"} (${entry?.kind ?? "none"})`),
    onFilterChange: (filter) => report(viewer, `filter ${JSON.stringify(filter)}`),
  };
}

// The left viewer is fed directly: a snapshot at mount, then `ingest` and
// `update`. The right one reads the same producer through a ViewerAdapter.
const adapter = memoryAdapter();
let left: ViewerInstance | undefined;
let right: ViewerInstance | undefined;
let added = 0;

function mountBoth(): void {
  // Entries added since the page loaded, so a remounted viewer starts from
  // the same state the producer is in.
  const later = Array.from({ length: added }, (_, index) => heartbeat(index + 1));
  left = mount(leftHost, {
    ...callbacks("left"),
    entries: [...SNAPSHOT, ...later],
    theme: { colorScheme: darkCheckbox.checked ? "dark" : "light" },
  });
  right = mount(rightHost, {
    ...callbacks("right"),
    adapter,
    theme: {
      colorScheme: "dark",
      tokens: { focusColor: "#e8a33d", selectedBackground: "#5c3d0e" },
    },
    strings: {
      listLabel: "Entrées de trace",
      empty: "Aucune entrée",
      noMatch: "Aucune entrée ne correspond au filtre",
      jumpToLatest: "Aller au plus récent",
    },
  });
  // The adapter only replays its snapshot; catch up with what was added.
  if (later.length > 0) right.ingest(later);
}

function unmountBoth(): void {
  left?.unmount();
  right?.unmount();
  left = undefined;
  right = undefined;
}

addButton.addEventListener("click", () => {
  added += 1;
  const entry = heartbeat(added);
  left?.ingest([entry]);
  adapter.push([{ type: "add", entry }]);
  report("host", `added ${entry.id}`);
});

updateButton.addEventListener("click", () => {
  left?.update([TENANT_UPDATE]);
  adapter.push([TENANT_UPDATE]);
  report("host", `tagged boot with tenant "acme"`);
});

darkCheckbox.addEventListener("change", () => {
  left?.setOptions({ theme: { colorScheme: darkCheckbox.checked ? "dark" : "light" } });
});

toggleButton.addEventListener("click", () => {
  if (left === undefined) {
    mountBoth();
    toggleButton.textContent = "Unmount";
    report("host", "mounted both viewers");
  } else {
    unmountBoth();
    toggleButton.textContent = "Mount";
    report("host", `unmounted both viewers (adapter connected: ${adapter.connected})`);
  }
  addButton.disabled = left === undefined;
  updateButton.disabled = left === undefined;
});

mountBoth();
