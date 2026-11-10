/**
 * A tiny host dictionary standing in for the simulator's i18next setup: the
 * viewer's `translate` prop takes any `(key, params) => string | undefined`,
 * so a host bridges it to its own library (`(key, params) => i18n.exists(...)
 * ? i18n.t(..., params) : undefined`) without the viewer depending on it.
 */
import type { TranslateFunction } from "@open-ocpp-trace/viewer-react";

export type Locale = "en" | "fr";

type Params = Readonly<Record<string, string | number | null>>;

/** `{name}` placeholders take the named parameter. */
function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}

/** French texts of the viewer, by the dotted keys of `defaultStrings`. */
const VIEWER_FR: Readonly<Record<string, string | ((params: Params) => string)>> = {
  listLabel: "Entrées de la trace",
  "columns.timestamp": "Horodatage",
  "columns.chargePoint": "Borne",
  "columns.connector": "Connecteur",
  "columns.direction": "Sens",
  "columns.messageType": "Type",
  "columns.action": "Action",
  "columns.messageId": "ID du message",
  loading: "Chargement des entrées…",
  empty: "Aucune entrée",
  noMatch: "Aucune entrée ne correspond au filtre",
  jumpToLatest: "Aller au plus récent",
  "toolbar.pause": "Pause",
  "toolbar.pending": "{count} en attente",
  "toolbar.follow": "Suivre le plus récent",
  "toolbar.exportSelection": "Exporter la sélection",
  "toolbar.exportFiltered": "Exporter le filtrage",
  "toolbar.exported": ({ count, skipped }) =>
    `${count} enregistrement(s) exporté(s)` +
    (typeof skipped === "number" && skipped > 0 ? ` (${skipped} ignoré(s))` : ""),
  "inspector.label": "Détails de l’entrée",
  "inspector.empty": "Aucune entrée sélectionnée",
  "inspector.goToResponse": "Aller à la réponse",
  "inspector.goToCall": "Aller au CALL",
  "inspector.noMatchingCall": "Aucun CALL correspondant",
  "inspector.fields.direction": "Sens",
  "inspector.fields.messageId": "ID du message",
  "inspector.fields.chargePoint": "Borne",
  "inspector.fields.timestamp": "Horodatage",
  "inspector.blocks.payload": "Charge utile",
  "inspector.blocks.raw": "Trame brute",
  "filter.panelLabel": "Filtres",
  "filter.reset": "Réinitialiser",
  "filter.clear": "Effacer",
  "filter.clearGroup": "Effacer {legend}",
  "filter.none": "(aucun)",
  "filter.chargePointIds": "Bornes",
  "filter.connectorIds": "Connecteurs",
  "filter.directions": "Sens",
  "filter.messageTypes": "Types de message",
  "filter.actions": "Actions",
  "filter.sourceIds": "Sources",
  "filter.search": "Recherche",
  "filter.text": "Texte",
};

/** The viewer's `translate` for `locale`; English keeps the defaults. */
export function viewerTranslate(locale: Locale): TranslateFunction | undefined {
  if (locale === "en") return undefined;
  return (key, params) => {
    const text = VIEWER_FR[key];
    if (text === undefined) return undefined;
    return typeof text === "function" ? text(params) : format(text, params);
  };
}

/** Texts of the host page itself. */
const PAGE = {
  en: {
    title: "OCPP CP Simulator traffic",
    intro:
      "A genuine two charge point capture of the OCPP CP Simulator (OCPP 1.6J), shown by viewer-react. The trace view holds the wire frames; the simulator's other log lines stay in the host's log panel.",
    language: "Language",
    mode: "Source",
    snapshot: "Captured file",
    live: "Live replay",
    play: "Play replay",
    pause: "Pause replay",
    replayed: "{position} of {total} records replayed",
    read: "{count} records read",
    issues: "Unreadable trace lines",
    issue: "Line {line} ({kind}): {message}",
    connectorColumn: "Connector (payload)",
    connectorField: "Connector (payload)",
    nextValidation: "Next validation warning",
    validationPanel: "Inbound validation",
    validationMode: "Mode",
    validationCode: "Error code",
    validationDescription: "Description",
    hostState: "Controlled state",
    hostStateHint: "Held by the page and mirrored in the URL hash.",
    lastExport: "Last export: {count} records ({scope})",
    log: "Simulator log",
    logCount: "{count} lines",
    logHint:
      "Application, scenario, status and server lines are not frames: the page lists them here instead of turning them into trace entries. They follow the charge point filter.",
  },
  fr: {
    title: "Trafic du simulateur OCPP CP",
    intro:
      "Une capture réelle de deux bornes du simulateur OCPP CP (OCPP 1.6J), affichée par viewer-react. La vue de trace contient les trames ; les autres lignes du journal restent dans le panneau de l’hôte.",
    language: "Langue",
    mode: "Source",
    snapshot: "Fichier capturé",
    live: "Rejeu en direct",
    play: "Lancer le rejeu",
    pause: "Mettre le rejeu en pause",
    replayed: "{position} sur {total} enregistrements rejoués",
    read: "{count} enregistrements lus",
    issues: "Lignes de trace illisibles",
    issue: "Ligne {line} ({kind}) : {message}",
    connectorColumn: "Connecteur (charge utile)",
    connectorField: "Connecteur (charge utile)",
    nextValidation: "Avertissement de validation suivant",
    validationPanel: "Validation entrante",
    validationMode: "Mode",
    validationCode: "Code d’erreur",
    validationDescription: "Description",
    hostState: "État contrôlé",
    hostStateHint: "Tenu par la page et reflété dans le hash de l’URL.",
    lastExport: "Dernier export : {count} enregistrements ({scope})",
    log: "Journal du simulateur",
    logCount: "{count} lignes",
    logHint:
      "Les lignes d’application, de scénario, d’état et du serveur ne sont pas des trames : la page les liste ici au lieu d’en faire des entrées de trace. Elles suivent le filtre de borne.",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type PageKey = keyof (typeof PAGE)["en"];

/** A text of the host page, with its `{name}` placeholders filled. */
export function pageText(locale: Locale, key: PageKey, params: Params = {}): string {
  return format(PAGE[locale][key], params);
}
