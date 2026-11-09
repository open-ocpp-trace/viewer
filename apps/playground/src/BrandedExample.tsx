import { useMemo, useState, type ReactElement } from "react";

import type { ColumnDefinition } from "@open-ocpp-trace/viewer-core";
import {
  TraceViewer,
  type DetailPanel,
  type PartialViewerStrings,
  type ToolbarAction,
  type ViewerTheme,
} from "@open-ocpp-trace/viewer-react";

import "./branded.css";
import { createSampleTrace, isCallError, siteColumn } from "./sample-trace.ts";

const { store, correlator } = createSampleTrace();

/** Tokens through the prop; the border and focus colors come from `.branded-host` instead. */
const THEME: ViewerTheme = {
  colorScheme: "dark",
  tokens: {
    background: "#111827",
    color: "#e5e7eb",
    headerBackground: "#1f2937",
    selectedBackground: "#7c3aed",
    selectedColor: "#ffffff",
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
  },
};

/** A partial French translation: the other strings stay English. */
const STRINGS: PartialViewerStrings = {
  listLabel: "Entrées de la trace",
  empty: "Aucune entrée",
  noMatch: "Aucune entrée ne correspond au filtre",
  unparsed: "Non analysée",
  jumpToLatest: "Aller au plus récent",
  detailPanelError: "Ce panneau n’a pas pu s’afficher.",
  columns: {
    timestamp: "Horodatage",
    chargePoint: "Borne",
    direction: "Sens",
    messageType: "Type",
    action: "Action",
    messageId: "ID du message",
  },
  toolbar: {
    pause: "Pause",
    pending: (count) => `${count} en attente`,
    follow: "Suivre le plus récent",
  },
  gap: (missedCount, reason) =>
    `Trou${missedCount === null ? "" : ` : ${missedCount} entrée(s) manquée(s)`}` +
    (reason === null ? "" : ` (${reason})`),
  inspector: {
    label: "Détails de l’entrée",
    empty: "Aucune entrée sélectionnée",
  },
};

const COLUMNS: readonly ColumnDefinition[] = [siteColumn("Site")];

const PANELS: readonly DetailPanel[] = [
  {
    id: "failure",
    title: "Échec",
    appliesTo: isCallError,
    render: ({ entry }) =>
      entry.kind === "trace" && entry.record.messageType === "CALLERROR" ? (
        <dl>
          <dt>Code</dt>
          <dd>{entry.record.error.code ?? "—"}</dd>
          <dt>Description</dt>
          <dd>{entry.record.error.description ?? "—"}</dd>
        </dl>
      ) : null,
  },
];

/** A dark, branded host: theme tokens, `--oot-*` overrides and French strings. */
export function BrandedExample(): ReactElement {
  const [status, setStatus] = useState("");
  const actions = useMemo(
    (): readonly ToolbarAction[] => [
      {
        id: "count-errors",
        label: "Compter les erreurs",
        run: (context) => {
          const errors = context.listed().filter(isCallError).length;
          setStatus(`${errors} erreur(s) parmi les entrées listées`);
        },
      },
    ],
    [],
  );
  return (
    <section className="branded-host">
      <h2>Hôte personnalisé</h2>
      <p>
        Une page sombre : jetons de thème passés en prop, propriétés <code>--oot-*</code> posées sur
        un ancêtre et chaînes partiellement traduites.
      </p>
      <p>
        <button type="button" className="branded-host__cta">
          Bouton de l’hôte
        </button>{" "}
        <output>{status}</output>
      </p>
      <table>
        <tbody>
          <tr>
            <th scope="row">Entrées</th>
            <td>{store.size}</td>
          </tr>
        </tbody>
      </table>
      <div className="branded-host__viewer">
        <TraceViewer
          store={store}
          correlator={correlator}
          theme={THEME}
          strings={STRINGS}
          columns={COLUMNS}
          toolbarActions={actions}
          detailPanels={PANELS}
        />
      </div>
    </section>
  );
}
