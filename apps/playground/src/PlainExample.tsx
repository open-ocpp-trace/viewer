import type { ReactElement } from "react";

import type { ColumnDefinition, EntryCorrelation } from "@open-ocpp-trace/viewer-core";
import {
  TraceViewer,
  type DetailPanel,
  type ToolbarAction,
  type ViewerTheme,
} from "@open-ocpp-trace/viewer-react";

import "./plain.css";
import { createSampleTrace, isCallError, siteColumn } from "./sample-trace.ts";

const { store, correlator } = createSampleTrace();

const THEME: ViewerTheme = { colorScheme: "light" };

const COLUMNS: readonly ColumnDefinition[] = [siteColumn("Site")];

const ACTIONS: readonly ToolbarAction[] = [
  {
    id: "latest-error",
    label: "Latest error",
    disabled: (context) => !context.listed().some(isCallError),
    run: (context) => {
      const latest = context.listed().reverse().find(isCallError);
      if (latest !== undefined) context.select(latest.id);
    },
  },
];

/** The entry paired with a correlated one, if any. */
function pairedId(correlation: EntryCorrelation | undefined): string | undefined {
  if (correlation?.role === "call") return correlation.responseId;
  if (correlation?.role === "response") return correlation.callId;
  return undefined;
}

const PANELS: readonly DetailPanel[] = [
  {
    id: "pairing",
    title: "Pairing",
    appliesTo: (entry) => entry.kind === "trace",
    render: (context) => {
      const correlation = context.correlator?.get(context.entry.id);
      const paired = pairedId(correlation);
      return (
        <p>
          {correlation === undefined ? "Not correlated" : `Role: ${correlation.role}`}{" "}
          {paired !== undefined && (
            <button type="button" onClick={() => context.select(paired)}>
              Open {paired}
            </button>
          )}
        </p>
      );
    },
  },
];

/** A light host with aggressive element rules of its own, scoped to `.plain-host`. */
export function PlainExample(): ReactElement {
  return (
    <section className="plain-host">
      <h2>Plain host</h2>
      <p>
        A light page whose own stylesheet restyles every <code>*</code>, <code>button</code> and{" "}
        <code>table</code> in this section. The viewer stylesheet adds no rule outside its{" "}
        <code>oot-</code> classes.
      </p>
      <p>
        <button type="button">Host button</button>
      </p>
      <table>
        <thead>
          <tr>
            <th>Host table</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Entries</td>
            <td>{store.size}</td>
          </tr>
        </tbody>
      </table>
      <div className="plain-host__viewer">
        <TraceViewer
          store={store}
          correlator={correlator}
          theme={THEME}
          columns={COLUMNS}
          toolbarActions={ACTIONS}
          detailPanels={PANELS}
        />
      </div>
    </section>
  );
}
