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
  pending: "pending: no analysis has run yet",
  rejected: "rejected: DebugKit rejected the whole snapshot",
  "mapping-broken": "mapping dropped: DebugKit's events did not fit the snapshot",
  "not-sent": "not sent: outside the analyzed snapshot (limits, or newer than it)",
  ambiguous: "ambiguous: several entries could be the source of one event, none is guessed",
  ignored: "ignored: DebugKit dropped this record (see its warnings)",
};

export interface AppProps {
  /** The store the viewer shows and DebugKit analyzes. */
  readonly store: ViewerStore;
}

/**
 * The viewer and DebugKit side by side. DebugKit analyzes a bounded snapshot
 * of the store (see `scheduler.ts`); the two views share one selection,
 * translated through the identity mapping of the current analysis only.
 */
export function App({ store }: AppProps): ReactElement {
  const [analysis, setAnalysis] = useState<Analysis>();
  const [selection, setSelection] = useState<ViewerSelection>({ entryId: null });
  const [stale, setStale] = useState(false);
  const [timelineNote, setTimelineNote] = useState<string | null>(null);
  const scheduler = useRef<AnalysisScheduler>(null);

  useEffect(() => {
    const created = createAnalysisScheduler({
      run: () => {
        setStale(false);
        setAnalysis(analyzeSnapshot(buildSnapshot(store.toArray())));
        // Event ids are only valid for the analysis that produced them.
        setTimelineNote(null);
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
    if (entryId === undefined || store.get(entryId) === undefined) {
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
            setSelection(next);
            setTimelineNote(null);
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
        <AnalysisStatus analysis={analysis} stale={stale} />
      </aside>
    </main>
  );
}
