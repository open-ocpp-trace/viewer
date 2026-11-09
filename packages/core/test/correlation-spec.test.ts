/**
 * Interoperability with the specification: every vendored conformance
 * fixture (see fixtures/spec/README.md) is read with the SDK reader, loaded
 * into a store and correlated, and the consumer view derived from the
 * correlator must equal the fixture's `expected.json` exactly.
 */
import { readdirSync, readFileSync } from "node:fs";

import type { TraceRecord } from "@open-ocpp-trace/core";
import { readRecords } from "@open-ocpp-trace/jsonl";
import { describe, expect, it } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type CorrelationScope,
  type Correlator,
  type EntryId,
  type TraceEntry,
} from "@open-ocpp-trace/viewer-core";

const FIXTURES = new URL("./fixtures/spec/", import.meta.url);
const SPEC_FIXTURE_COUNT = 16;

const fixtureNames = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

/** The consumer view of the specification's conformance README. */
interface ConsumerView {
  readonly schemaVersion: string;
  readonly counts: {
    readonly records: number;
    readonly calls: number;
    readonly callResults: number;
    readonly callErrors: number;
  };
  readonly records: readonly {
    readonly index: number;
    readonly messageType: string;
    /** Optional in an SDK record; every fixture record carries one. */
    readonly messageId?: string;
    readonly action?: string;
    readonly correlatesWith?: number;
  }[];
  readonly unansweredCalls: readonly number[];
  readonly orphanResponses: readonly number[];
}

function readFixtureFile(name: string, file: string): string {
  return readFileSync(new URL(`${name}/${file}`, FIXTURES), "utf8");
}

async function readTrace(name: string): Promise<TraceRecord[]> {
  const records: TraceRecord[] = [];
  for await (const record of readRecords([readFixtureFile(name, "trace.jsonl")])) {
    records.push(record);
  }
  return records;
}

/** Record i becomes entry `spec:<i>`; `indexOf` maps it back. */
function toEntries(records: readonly TraceRecord[]): {
  entries: TraceEntry[];
  indexOf: (id: EntryId) => number;
} {
  const entries = records.map((record, index): TraceEntry => ({
    kind: "trace",
    id: `spec:${index}`,
    record,
  }));
  const indexes = new Map(entries.map((entry, index) => [entry.id, index]));
  return {
    entries,
    indexOf(id) {
      const index = indexes.get(id);
      if (index === undefined) throw new Error(`unknown entry id ${id}`);
      return index;
    },
  };
}

function consumerView(records: readonly TraceRecord[], scope?: CorrelationScope): ConsumerView {
  const { entries, indexOf } = toEntries(records);
  const store = createViewerStore({ maxEntries: entries.length, maxBytes: 2 ** 30 });
  store.load(entries);
  expect(store.toArray()).toHaveLength(entries.length);
  const correlator: Correlator = createCorrelator(scope === undefined ? undefined : { scope });
  correlator.connect(store);

  const ascending = (ids: readonly EntryId[]): number[] => ids.map(indexOf).sort((a, b) => a - b);
  const count = (messageType: TraceRecord["messageType"]): number =>
    records.filter((record) => record.messageType === messageType).length;

  return {
    schemaVersion: records[0]?.schemaVersion ?? "",
    counts: {
      records: records.length,
      calls: count("CALL"),
      callResults: count("CALLRESULT"),
      callErrors: count("CALLERROR"),
    },
    records: entries.map(({ id, record }, index) => {
      const correlation = correlator.get(id);
      return {
        index,
        messageType: record.messageType,
        ...(record.messageId !== undefined && { messageId: record.messageId }),
        ...(correlation?.action !== undefined && { action: correlation.action }),
        ...(correlation?.role === "response" && { correlatesWith: indexOf(correlation.callId) }),
      };
    }),
    unansweredCalls: ascending(correlator.unansweredCalls()),
    orphanResponses: ascending(correlator.orphanResponses()),
  };
}

describe("Correlator against the specification fixtures", () => {
  it(`finds the ${SPEC_FIXTURE_COUNT} vendored fixtures`, () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(SPEC_FIXTURE_COUNT);
  });

  describe.each(fixtureNames)("%s", (name) => {
    const expected = JSON.parse(readFixtureFile(name, "expected.json")) as ConsumerView;

    it.each([
      { label: "global", scope: "global" as const },
      { label: "default", scope: undefined },
    ])("reproduces expected.json in the $label scope", async ({ scope }) => {
      const records = await readTrace(name);

      expect(consumerView(records, scope)).toStrictEqual(expected);
    });
  });
});
