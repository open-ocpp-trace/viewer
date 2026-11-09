import { parseOpenOcppTrace, type ParseResult } from "@ocpp-debugkit/toolkit/core";
import { FailureSummary, MessageInspector, SessionTimeline } from "@ocpp-debugkit/toolkit/react";
import type { ViewerSelection, ViewerStore } from "@open-ocpp-trace/viewer-core";
import { TraceViewer, type DetailPanel, type ToolbarAction } from "@open-ocpp-trace/viewer-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { analyzeSnapshot, type Analysis } from "./analysis.ts";
import { AnalysisStatus } from "./AnalysisStatus.tsx";
import { entryStatus, type NotAnalyzedReason } from "./entry-status.ts";
import { createAnalysisScheduler, type AnalysisScheduler } from "./scheduler.ts";
import { buildSnapshot } from "./snapshot.ts";

const NOT_ANALYZED: Record<NotAnalyzedReason, string> = {
  unparsed: "unparsed: the SDK reader rejected this line, so it was never sent",
  gap: "gap marker: not a record, so it was never sent",
  pending: "pending: not analyzed yet (no analysis has run since this entry was added)",
  rejected: "rejected: DebugKit rejected the whole snapshot",
  "mapping-broken": "mapping dropped: DebugKit's events did not fit the snapshot",
  "not-sent": "not sent: outside the analyzed snapshot (limits, or newer than it)",
  ambiguous: "ambiguous: several entries could be the source of one event, none is guessed",
  ignored: "ignored: DebugKit dropped this record (see its warnings)",
};

export interface AppProps {
  /** The store the viewer shows and DebugKit analyzes. */
  readonly store: ViewerStore;
  /** DebugKit's parser; replaced in tests to make an analysis fail. */
  readonly parse?: (input: string) => ParseResult;
}

/**
 * The viewer and DebugKit side by side. DebugKit analyzes a bounded snapshot
 * of the store (see `scheduler.ts`); the two views share one selection,
 * translated through the identity mapping of the current analysis only.
 */
export function App({ store, parse = parseOpenOcppTrace }: AppProps): ReactElement {
  const [analysis, setAnalysis] = useState<Analysis>();
  const [failure, setFailure] = useState<string>();
  const [selection, setSelection] = useState<ViewerSelection>({ entryId: null });
  const [stale, setStale] = useState(false);
  const [timelineNote, setTimelineNote] = useState<string | null>(null);
  const scheduler = useRef<AnalysisScheduler>(null);
  // Read at run time, so a new parser identity never re-creates the scheduler.
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    const created = createAnalysisScheduler({
      run: () => {
        // Computed first: if it throws, the previous analysis stays stale.
        const next = analyzeSnapshot(buildSnapshot(store.toArray()), parseRef.current);
        setAnalysis(next);
        setStale(false);
        setFailure(undefined);
        // Event ids are only valid for the analysis that produced them.
        setTimelineNote(null);
      },
      onError: (error) => {
        console.error(error);
        setFailure(error instanceof Error ? error.message : String(error));
      },
    });
    scheduler.current = created;
    const unsubscribe = store.subscribe(() => {
      setStale(true);
      created.markStale();
    });
    // The fixtures were loaded before this subscription: analyze them now.
    created.runNow();
    return () => {
      unsubscribe();
      created.dispose();
      scheduler.current = null;
    };
  }, [store]);

  const eventsById = useMemo(
    () => new Map(analysis?.events.map((event) => [event.id, event])),
    [analysis],
  );

  const toolbarActions = useMemo<readonly ToolbarAction[]>(
    () => [{ id: "analyze-now", label: "Analyze now", run: () => scheduler.current?.runNow() }],
    [],
  );

  const detailPanels = useMemo<readonly DetailPanel[]>(
    () => [
      {
        id: "debugkit",
        title: "DebugKit",
        render: ({ entry }) => {
          const status = entryStatus(analysis, entry);
          if ("eventId" in status) {
            return <MessageInspector event={eventsById.get(status.eventId) ?? null} />;
          }
          return (
            <p className="debugkit-note">
              Not analyzed by DebugKit: {NOT_ANALYZED[status.reason]}.
            </p>
          );
        },
      },
    ],
    [analysis, eventsById],
  );

  const selected = selection.entryId === null ? undefined : store.get(selection.entryId);
  const selectedStatus = selected === undefined ? undefined : entryStatus(analysis, selected);
  const selectedEventId =
    selectedStatus !== undefined && "eventId" in selectedStatus ? selectedStatus.eventId : null;

  function selectEvent(eventId: string): void {
    const entryId = analysis?.mapping.entryByEvent.get(eventId);
    const entry = entryId === undefined ? undefined : store.get(entryId);
    // The same rule as the other direction: a reused id is not this event's entry.
    if (
      entryId === undefined ||
      entry === undefined ||
      !("eventId" in entryStatus(analysis, entry))
    ) {
      setTimelineNote(`Event ${eventId} has no single viewer entry; the selection is unchanged.`);
      return;
    }
    setTimelineNote(null);
    setSelection({ entryId });
  }

  return (
    <main className="debugkit-example">
      <div className="debugkit-example__viewer">
        <TraceViewer
          store={store}
          selection={selection}
          onSelectionChange={(next) => {
            // The viewer clears the selection once its entry leaves the store.
            const left =
              next.entryId === null &&
              selection.entryId !== null &&
              store.get(selection.entryId) === undefined;
            setSelection(next);
            setTimelineNote(
              left
                ? "The selected entry left the store (evicted or cleared); nothing is selected."
                : null,
            );
          }}
          toolbarActions={toolbarActions}
          detailPanels={detailPanels}
        />
      </div>
      <aside className="debugkit-example__analysis">
        <section aria-label="DebugKit timeline">
          <p role="status" aria-label="Timeline selection">
            {timelineNote ??
              (selectedStatus !== undefined && "reason" in selectedStatus
                ? `The selected entry was not analyzed by DebugKit (${selectedStatus.reason}).`
                : "")}
          </p>
          <SessionTimeline
            events={[...(analysis?.events ?? [])]}
            selectedEventId={selectedEventId}
            onSelectEvent={selectEvent}
          />
        </section>
        <section aria-label="DebugKit failures">
          <FailureSummary failures={[...(analysis?.failures ?? [])]} />
        </section>
        <AnalysisStatus analysis={analysis} stale={stale} failure={failure} />
      </aside>
    </main>
  );
}
