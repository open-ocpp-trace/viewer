import { createViewerStore, type ViewerStore } from "@open-ocpp-trace/viewer-core";

import spec from "../../../packages/core/test/fixtures/spec/failed-auth/trace.jsonl?raw";
import edgeCases from "./fixtures/hand-written-edge-cases.jsonl?raw";
import { readFixtureEntries } from "./load-fixture.ts";

/**
 * The store the example shows: the vendored `failed-auth` specification
 * fixture, then the hand-written edge cases (records DebugKit drops or warns
 * about, a line the SDK reader rejects, an ambiguous pair), both read with
 * the released SDK reader.
 */
export async function createExampleStore(): Promise<ViewerStore> {
  const store = createViewerStore();
  store.load(await readFixtureEntries("failed-auth", spec));
  store.load(await readFixtureEntries("edge", edgeCases));
  return store;
}
