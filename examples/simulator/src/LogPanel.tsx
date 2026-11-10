import { type ReactElement, useMemo } from "react";

import { type Locale, pageText } from "./i18n.ts";
import { readSimulatorLogs } from "./logs.ts";

export interface LogPanelProps {
  readonly logsText: string;
  readonly locale: Locale;
  /** The viewer's charge point filter: the panel follows it. */
  readonly chargePointIds: readonly (string | null)[] | undefined;
}

/**
 * The simulator's non-wire log lines, in a plain host list. They stay out of
 * the trace view: they are not frames, and the wire lines are already there
 * as records. A real host would keep its own LogViewer here.
 */
export function LogPanel(props: LogPanelProps): ReactElement {
  const { logsText, locale, chargePointIds } = props;
  const logs = useMemo(() => readSimulatorLogs(logsText), [logsText]);
  const shown = logs.lines.filter(
    (line) =>
      !line.wire &&
      (chargePointIds === undefined ||
        chargePointIds.length === 0 ||
        chargePointIds.includes(line.cpId ?? null)),
  );
  const title = pageText(locale, "log");
  return (
    <section className="log-panel" aria-label={title}>
      <h2>{title}</h2>
      <p>
        {pageText(locale, "logCount", { count: shown.length })}. {pageText(locale, "logHint")}
      </p>
      <ol className="log-panel__lines">
        {shown.map((line) => (
          <li
            key={line.line}
            className={`log-panel__line log-panel__line--${line.level.toLowerCase()}`}
          >
            <time dateTime={line.timestamp}>{line.timestamp.slice(11, 23)}</time>{" "}
            <span className="log-panel__level">{line.level}</span>{" "}
            <span className="log-panel__cp">{line.cpId ?? "—"}</span>{" "}
            <span className="log-panel__type">{line.type}</span> {line.message}
          </li>
        ))}
      </ol>
    </section>
  );
}
