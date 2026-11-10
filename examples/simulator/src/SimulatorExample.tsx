import { type ReactElement, useEffect, useMemo, useState } from "react";

import {
  type Correlator,
  createCorrelator,
  createViewerStore,
  type ColumnDefinition,
  type FilterFieldDefinition,
  type TraceEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import {
  type DetailPanel,
  type ExportScope,
  type JsonlExport,
  type PartialViewerStrings,
  type ToolbarAction,
  TraceViewer,
  type ViewerTheme,
} from "@open-ocpp-trace/viewer-react";

import { createLiveAdapter } from "./adapter/live-adapter.ts";
import { createReplay, type Replay } from "./adapter/replay.ts";
import { readSimulatorTrace, type SimulatorTrace } from "./adapter/trace-reader.ts";
import { CONNECTOR_FIELD, connectorColumn, validationOf } from "./fields.ts";
import { SIMULATOR_LOGS, SIMULATOR_TRACE } from "./fixtures.ts";
import { decodeHostState, encodeHostState, type HostState } from "./host-state.ts";
import { type Locale, pageText, viewerTranslate } from "./i18n.ts";
import { LogPanel } from "./LogPanel.tsx";

export interface SimulatorExampleProps {
  /** TraceWriter JSONL; the bundled capture by default. */
  readonly traceText?: string;
  /** The simulator's JSON log lines; the bundled capture by default. */
  readonly logsText?: string;
  /** Delay between two replayed records in live mode. */
  readonly replayIntervalMs?: number;
  /** Saves an export; a browser download by default. */
  readonly download?: (fileName: string, text: string) => void;
}

type Mode = "snapshot" | "live";

/** One viewer's data: a fresh store and correlator per mode. */
interface Session {
  readonly store: ViewerStore;
  readonly correlator: Correlator;
  readonly replay?: Replay;
}

function createSession(
  entries: readonly TraceEntry[],
  mode: Mode,
  intervalMs: number,
  onChange: () => void,
): Session {
  const store = createViewerStore();
  // The simulator gives no session id, so the default `conversation` scope
  // behaves as `chargePoint`; naming it states what keeps the colliding
  // CSMS message ids (`csms-0001` on CP001 and on CP002) apart.
  const correlator = createCorrelator({ scope: "chargePoint" });
  correlator.connect(store);
  if (mode === "snapshot") {
    store.load(entries);
    return { store, correlator };
  }
  const live = createLiveAdapter();
  store.connect(live.adapter);
  const replay = createReplay({ entries, push: live.push, intervalMs, onChange });
  return { store, correlator, replay };
}

function browserDownload(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/jsonl" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function readHash(): HostState {
  return decodeHostState(window.location.hash);
}

/** A brand accent through theme tokens; the rest comes from page.css. */
const THEME: ViewerTheme = {
  colorScheme: "auto",
  tokens: { selectedBackground: "#0f766e", selectedColor: "#ffffff" },
};

/** `strings` overrides apply after `translate`, in every language. */
const STRINGS: PartialViewerStrings = { columns: { messageType: "Message type" } };

export function SimulatorExample(props: SimulatorExampleProps): ReactElement {
  const {
    traceText = SIMULATOR_TRACE,
    logsText = SIMULATOR_LOGS,
    replayIntervalMs = 250,
    download = browserDownload,
  } = props;
  const [locale, setLocale] = useState<Locale>("en");
  const [mode, setMode] = useState<Mode>("snapshot");
  const [trace, setTrace] = useState<SimulatorTrace | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [, setReplayTick] = useState(0);
  const [hostState, setHostState] = useState<HostState>(readHash);
  const [lastExport, setLastExport] = useState<{ count: number; scope: ExportScope } | null>(null);
  const text = (key: Parameters<typeof pageText>[1], params?: Parameters<typeof pageText>[2]) =>
    pageText(locale, key, params);

  useEffect(() => {
    let cancelled = false;
    void readSimulatorTrace(traceText).then((read) => {
      if (!cancelled) setTrace(read);
    });
    return () => {
      cancelled = true;
    };
  }, [traceText]);

  useEffect(() => {
    if (trace === null) return undefined;
    const next = createSession(trace.entries, mode, replayIntervalMs, () =>
      setReplayTick((tick) => tick + 1),
    );
    setSession(next);
    return () => next.replay?.pause();
  }, [trace, mode, replayIntervalMs]);

  // The hash mirrors the controlled state, and a hash edited by hand (or
  // the back button) drives it.
  useEffect(() => {
    const hash = encodeHostState(hostState);
    if (hash !== window.location.hash) {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", `${pathname}${search}${hash}`);
    }
  }, [hostState]);
  useEffect(() => {
    const onHashChange = (): void => setHostState(readHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const translate = useMemo(() => viewerTranslate(locale), [locale]);
  const columns = useMemo(
    (): readonly ColumnDefinition[] => [connectorColumn(pageText(locale, "connectorColumn"))],
    [locale],
  );
  const toolbarActions = useMemo(
    (): readonly ToolbarAction[] => [
      {
        id: "next-validation",
        label: pageText(locale, "nextValidation"),
        disabled: (context) => !context.listed().some((entry) => validationOf(entry)),
        run: (context) => {
          const listed = context.listed();
          const current = listed.findIndex((entry) => entry.id === context.selection.entryId);
          const after = [...listed.slice(current + 1), ...listed.slice(0, current + 1)];
          const next = after.find((entry) => validationOf(entry) !== undefined);
          if (next !== undefined) context.select(next.id);
        },
      },
    ],
    [locale],
  );
  const detailPanels = useMemo(
    (): readonly DetailPanel[] => [
      {
        id: "validation",
        title: pageText(locale, "validationPanel"),
        appliesTo: (entry) => validationOf(entry) !== undefined,
        render: ({ entry }) => {
          const validation = validationOf(entry);
          return validation === undefined ? null : (
            <dl className="validation">
              <dt>{pageText(locale, "validationMode")}</dt>
              <dd>{validation.mode}</dd>
              <dt>{pageText(locale, "validationCode")}</dt>
              <dd>{validation.errorCode}</dd>
              <dt>{pageText(locale, "validationDescription")}</dt>
              <dd>{validation.description}</dd>
            </dl>
          );
        },
      },
    ],
    [locale],
  );
  const fields = useMemo(
    (): readonly FilterFieldDefinition[] => [
      { ...CONNECTOR_FIELD, label: pageText(locale, "connectorField") },
    ],
    [locale],
  );

  const onExport = (exported: JsonlExport, scope: ExportScope): void => {
    download(`simulator-${scope}.jsonl`, exported.text);
    setLastExport({ count: exported.recordCount, scope });
  };

  const replay = session?.replay;
  return (
    <main className="page" lang={locale}>
      <header className="page__header">
        <h1>{text("title")}</h1>
        <p>{text("intro")}</p>
        <div className="page__controls">
          <div role="group" aria-label={text("language")}>
            {(["en", "fr"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={locale === value}
                onClick={() => setLocale(value)}
              >
                {value === "en" ? "English" : "Français"}
              </button>
            ))}
          </div>
          <div role="group" aria-label={text("mode")}>
            {(["snapshot", "live"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
              >
                {text(value)}
              </button>
            ))}
          </div>
          {replay === undefined ? null : (
            <>
              <button
                type="button"
                disabled={replay.done}
                onClick={() => (replay.playing ? replay.pause() : replay.play())}
              >
                {replay.playing ? text("pause") : text("play")}
              </button>
              <span>{text("replayed", { position: replay.position, total: replay.total })}</span>
            </>
          )}
          {trace === null ? null : (
            <span role="status">{text("read", { count: trace.entries.length })}</span>
          )}
        </div>
        {trace !== null && trace.issues.length > 0 ? (
          <section className="page__issues" aria-label={text("issues")}>
            <h2>{text("issues")}</h2>
            <ul>
              {trace.issues.map((issue) => (
                <li key={issue.line}>
                  {text("issue", { line: issue.line, kind: issue.kind, message: issue.message })}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </header>
      <div className="page__body">
        <div className="page__viewer">
          {session === null ? null : (
            <TraceViewer
              store={session.store}
              correlator={session.correlator}
              fields={fields}
              columns={columns}
              filter={hostState.filter}
              onFilterChange={(filter) => setHostState((state) => ({ ...state, filter }))}
              selection={hostState.selection}
              onSelectionChange={(selection) => setHostState((state) => ({ ...state, selection }))}
              onExport={onExport}
              theme={THEME}
              strings={STRINGS}
              {...(translate !== undefined && { translate })}
              toolbarActions={toolbarActions}
              detailPanels={detailPanels}
              className="simulator-viewer"
            />
          )}
        </div>
        <aside className="page__side">
          <section aria-label={text("hostState")}>
            <h2>{text("hostState")}</h2>
            <p>{text("hostStateHint")}</p>
            <pre>{JSON.stringify(hostState, null, 2)}</pre>
            {lastExport === null ? null : (
              <p>{text("lastExport", { count: lastExport.count, scope: lastExport.scope })}</p>
            )}
          </section>
          <LogPanel
            logsText={logsText}
            locale={locale}
            chargePointIds={hostState.filter.chargePointIds}
          />
        </aside>
      </div>
    </main>
  );
}
