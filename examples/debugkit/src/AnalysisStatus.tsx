import type { ReactElement } from "react";

import type { Analysis } from "./analysis.ts";

export interface AnalysisStatusProps {
  readonly analysis: Analysis | undefined;
  /** The store changed since this analysis: a refresh is due. */
  readonly stale: boolean;
  /**
   * Why the last analysis failed (an error other than DebugKit's ParseError),
   * when it did: `analysis` is then the one before it.
   */
  readonly failure?: string | undefined;
}

/**
 * What DebugKit was given and what it made of it: counts, the ParseError
 * message, why the mapping was dropped, and DebugKit's warnings verbatim.
 * Warnings are listed for the whole analysis, never attached to an entry:
 * their `index` lives in several index spaces.
 */
export function AnalysisStatus({ analysis, stale, failure }: AnalysisStatusProps): ReactElement {
  return (
    <section aria-label="DebugKit analysis" className="debugkit-status">
      <h2>DebugKit analysis</h2>
      {stale && <p>The trace changed since this analysis; a refresh is scheduled.</p>}
      {failure !== undefined && <p role="alert">The last analysis failed: {failure}</p>}
      {analysis === undefined ? <p>Not analyzed yet.</p> : <Details analysis={analysis} />}
    </section>
  );
}

function Details({ analysis }: { readonly analysis: Analysis }): ReactElement {
  const { snapshot, mapping, warnings } = analysis;
  const { unparsed, gap, invalid } = snapshot.skipped;
  return (
    <>
      <p>
        Snapshot: {snapshot.lines.length} lines
        {snapshot.truncated > 0 &&
          `; the ${snapshot.truncated} oldest trace entries were left out (snapshot limits)`}
        .
      </p>
      <p>
        Not sent: {unparsed} unparsed, {gap} gaps, {invalid} invalid.
      </p>
      {analysis.error !== undefined && <p>DebugKit rejected the snapshot: {analysis.error}</p>}
      <p>
        DebugKit events: {analysis.events.length}; failures: {analysis.failures.length}.
      </p>
      {mapping.reason !== undefined && <p>Mapping dropped: {mapping.reason}</p>}
      <p>
        Unmapped entries: {mapping.unmappedEntryIds.length} ({mapping.ambiguousEntryIds.length}{" "}
        ambiguous). Unmatched events: {mapping.unmatchedEventIds.length}.
      </p>
      <h3>DebugKit warnings ({warnings.length})</h3>
      <ul>
        {warnings.map((warning, index) => (
          <li key={index}>{warning.message}</li>
        ))}
      </ul>
    </>
  );
}
