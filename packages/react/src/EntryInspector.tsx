import {
  Component,
  Fragment,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  type Correlator,
  type EntryId,
  type GapEntry,
  readEntryFields,
  type TraceEntry,
  type UnparsedEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

import {
  DEFAULT_MAX_DEPTH,
  defaultSensitiveKeys,
  type Formatted,
  formatValue,
  sensitiveKeySet,
} from "./inspect-format.ts";
import { defaultStrings } from "./strings.ts";

/** The block a copied text comes from. */
export type InspectorPart = "payload" | "raw" | "error" | "meta";

/** Props of {@link EntryInspector}. */
export interface EntryInspectorProps {
  store: ViewerStore;
  /** The entry to show; null shows an empty state. */
  entryId: EntryId | null;
  /** Gives the derived action and the paired-message links. */
  correlator?: Correlator;
  /** Called by a paired-message link; links are not rendered without it. */
  onNavigate?: (id: EntryId) => void;
  /**
   * Copy buttons are rendered only with it. The text is the whole block,
   * printed on click without the `maxChars` limit, sensitive fields redacted.
   */
  onCopy?: (text: string, part: InspectorPart) => void;
  /**
   * Renders the printed payload text (syntax highlighting); its output is
   * placed in the payload block. Not used for a truncated payload; a throw
   * falls back to the plain text. Memoize it.
   */
  renderPayload?: (text: string, entry: TraceEntry) => ReactNode;
  /**
   * Shows the values of sensitive fields, otherwise printed `"[redacted]"`.
   * While they are hidden, the raw frame of a record is not shown either
   * when a value was redacted or its payload or error details were not
   * printed whole. The raw frame of an unparsed entry is always shown, as
   * it cannot be inspected. Value-based secrets (a `SetVariables` value
   * whose variable is `BasicAuthPassword`) are not detected.
   */
  revealSensitive?: boolean;
  /** Property names to redact, case-insensitively; default `defaultSensitiveKeys`. Memoize it. */
  sensitiveKeys?: readonly string[];
  /** Initial printed length of each block; « Show more » multiplies it by 4. Default 20 000. */
  maxChars?: number;
  className?: string;
}

const strings = defaultStrings.inspector;
const labels = strings.fields;

function useVersion(source?: { subscribe(listener: () => void): () => void; version: number }) {
  const subscribe = useCallback(
    (onChange: () => void) => (source === undefined ? () => {} : source.subscribe(onChange)),
    [source],
  );
  const read = (): number => source?.version ?? 0;
  return useSyncExternalStore(subscribe, read, read);
}

/** Reads a property of untrusted data without throwing. */
function read(value: unknown, key: string): unknown {
  try {
    return typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : null;
}

function Fields({ fields }: { fields: readonly (readonly [string, string | null])[] }) {
  const shown = fields.filter(([, value]) => value !== null && value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="oot-inspector__fields">
      {shown.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Code({ title, children }: { title: string; children: ReactNode }) {
  return (
    <pre className="oot-inspector__code" tabIndex={0} aria-label={title}>
      {children}
    </pre>
  );
}

interface BlockProps {
  title: string;
  printed: { readonly text: string; readonly truncated: boolean };
  onMore: () => void;
  onCopy: (() => void) | undefined;
  total?: number;
  children?: ReactNode;
}

function Block({ title, printed, onMore, onCopy, total, children }: BlockProps) {
  return (
    <div className="oot-inspector__block">
      <div className="oot-inspector__title">
        {title}
        {onCopy !== undefined && (
          <button type="button" onClick={onCopy}>
            {strings.copy(title)}
          </button>
        )}
      </div>
      {children ?? <Code title={title}>{printed.text}</Code>}
      {printed.truncated && (
        <div className="oot-inspector__more">
          <button type="button" onClick={onMore}>
            {strings.showMore}
          </button>
          {total !== undefined && <span>{strings.totalSize(total)}</span>}
        </div>
      )}
    </div>
  );
}

class PayloadBoundary extends Component<{ fallback: ReactNode; children: ReactNode }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const HostPayload = memo(function HostPayload(props: {
  render: (text: string, entry: TraceEntry) => ReactNode;
  text: string;
  entry: TraceEntry;
}) {
  return <>{props.render(props.text, props.entry)}</>;
});

interface DetailsProps {
  props: EntryInspectorProps;
  keys: ReadonlySet<string> | null;
  copy: (build: () => string, part: InspectorPart) => (() => void) | undefined;
}

/** The « Show more » step of each block, reset with the entry (the parent keys on its id). */
function useLimits(maxChars: number) {
  const [steps, setSteps] = useState<Readonly<Record<string, number>>>({});
  return {
    step: (name: string): number => steps[name] ?? 0,
    limit: (name: string): number => maxChars * 4 ** (steps[name] ?? 0),
    more: (name: string) => () => setSteps((all) => ({ ...all, [name]: (all[name] ?? 0) + 1 })),
  };
}

function rawBlock(raw: string, limits: ReturnType<typeof useLimits>, copy: DetailsProps["copy"]) {
  const limit = limits.limit("raw");
  const printed = { text: raw.slice(0, limit), truncated: raw.length > limit };
  return (
    <Block
      title={strings.blocks.raw}
      printed={printed}
      onMore={limits.more("raw")}
      onCopy={copy(() => raw, "raw")}
      total={raw.length}
    />
  );
}

function usePrinted(value: unknown, limit: number, keys: ReadonlySet<string> | null) {
  return useMemo(
    () =>
      value === undefined
        ? null
        : formatValue(value, { maxChars: limit, maxDepth: DEFAULT_MAX_DEPTH, sensitiveKeys: keys }),
    [value, limit, keys],
  );
}

function TraceDetails({ entry, props, keys, copy }: DetailsProps & { entry: TraceEntry }) {
  const { record, metadata } = entry;
  const limits = useLimits(props.maxChars ?? 20_000);
  const fields = readEntryFields(entry, props.correlator);
  const error = fields.messageType === "CALLERROR" ? read(record, "error") : undefined;
  const values = {
    payload: read(record, "payload"),
    error: read(error, "details"),
    meta: read(record, "meta"),
    custom: read(metadata, "custom"),
  };
  const printed: Record<keyof typeof values, Formatted | null> = {
    payload: usePrinted(values.payload, limits.limit("payload"), keys),
    error: usePrinted(values.error, limits.limit("error"), keys),
    meta: usePrinted(values.meta, limits.limit("meta"), keys),
    custom: usePrinted(values.custom, limits.limit("custom"), keys),
  };
  const unsure = (p: Formatted | null) =>
    p !== null && (p.redactedCount > 0 || p.truncated || p.elided);
  const rawHidden =
    keys !== null &&
    (unsure(printed.payload) || unsure(printed.error) || (printed.meta?.redactedCount ?? 0) > 0);
  const raw = text(read(record, "raw"));
  const source = read(metadata, "source");
  const sourceId = text(read(source, "id"));
  const deliveries = read(metadata, "deliveries");
  const delivered = Array.isArray(deliveries)
    ? deliveries
        .slice(0, 64)
        .map((d) =>
          strings.delivery(
            text(read(d, "target")) ?? "",
            text(read(d, "role")),
            text(read(d, "status")) ?? "",
            text(read(d, "reason")),
            text(read(d, "updatedAt")),
          ),
        )
        .join("\n")
    : null;

  const block = (name: keyof typeof values, part: InspectorPart | null) => {
    const shown = printed[name];
    if (shown === null) return null;
    const title = strings.blocks[name];
    const plain = <Code title={title}>{shown.text}</Code>;
    const render = props.renderPayload;
    return (
      <Block
        title={title}
        printed={shown}
        onMore={limits.more(name)}
        onCopy={
          part === null
            ? undefined
            : copy(
                () =>
                  formatValue(values[name], {
                    maxChars: Number.POSITIVE_INFINITY,
                    maxDepth: DEFAULT_MAX_DEPTH,
                    sensitiveKeys: keys,
                  }).text,
                part,
              )
        }
      >
        {name === "payload" && render !== undefined && !shown.truncated ? (
          <PayloadBoundary key={limits.step(name)} fallback={plain}>
            <Code title={title}>
              <HostPayload render={render} text={shown.text} entry={entry} />
            </Code>
          </PayloadBoundary>
        ) : undefined}
      </Block>
    );
  };

  return (
    <>
      <Fields
        fields={[
          [labels.messageType, fields.messageType],
          [labels.action, fields.action],
          [labels.direction, fields.direction],
          [labels.messageId, fields.messageId],
          [labels.chargePoint, fields.chargePointId],
          [labels.connector, text(fields.connectorId)],
          [labels.ocppVersion, text(read(record, "ocppVersion"))],
          [labels.transport, text(read(record, "transport"))],
          [labels.timestamp, fields.timestamp],
          [labels.receivedAt, text(entry.receivedAt)],
          [labels.errorCode, text(read(error, "code"))],
          [labels.errorDescription, text(read(error, "description"))],
        ]}
      />
      <Pairing entry={entry} props={props} />
      {block("error", "error")}
      {block("payload", "payload")}
      {raw !== null &&
        (rawHidden ? (
          <p className="oot-inspector__note">{strings.rawHidden}</p>
        ) : (
          rawBlock(raw, limits, copy)
        ))}
      {block("meta", "meta")}
      <Fields
        fields={[
          [labels.tenant, text(read(metadata, "tenant"))],
          [
            labels.source,
            sourceId === null ? null : strings.source(sourceId, text(read(source, "label"))),
          ],
          [labels.session, text(read(metadata, "sessionId"))],
          [labels.conversation, text(read(metadata, "conversationId"))],
          [labels.deliveries, delivered],
        ]}
      />
      {block("custom", null)}
    </>
  );
}

function Pairing({ entry, props }: { entry: TraceEntry; props: EntryInspectorProps }) {
  const { store, correlator, onNavigate } = props;
  const pairing = correlator?.get(entry.id);
  if (pairing === undefined) return null;
  const link = (label: string, id: EntryId) => {
    if (onNavigate === undefined) return null;
    if (store.get(id) === undefined) {
      return (
        <span key={id} className="oot-inspector__link" aria-disabled="true">
          {label}
        </span>
      );
    }
    return (
      <button key={id} type="button" className="oot-inspector__link" onClick={() => onNavigate(id)}>
        {label}
      </button>
    );
  };
  return (
    <div className="oot-inspector__pairing">
      {pairing.role === "call" &&
        pairing.responseId !== undefined &&
        link(strings.goToResponse, pairing.responseId)}
      {pairing.role === "response" && link(strings.goToCall, pairing.callId)}
      {pairing.role === "orphan" && (
        <>
          <span>{strings.noMatchingCall}</span>
          {pairing.candidates.slice(0, 5).map((id, i) => link(strings.candidate(i + 1), id))}
        </>
      )}
    </div>
  );
}

function UnparsedDetails({ entry, props, copy }: DetailsProps & { entry: UnparsedEntry }) {
  const limits = useLimits(props.maxChars ?? 20_000);
  return (
    <>
      <p className="oot-inspector__badge">{defaultStrings.unparsed}</p>
      <Fields
        fields={[
          [labels.reason, text(entry.reason)],
          [labels.timestamp, text(entry.timestamp)],
          [labels.direction, text(entry.direction)],
          [labels.transport, text(entry.transport)],
          [labels.receivedAt, text(entry.receivedAt)],
        ]}
      />
      {rawBlock(text(entry.raw) ?? "", limits, copy)}
    </>
  );
}

function GapDetails({ entry }: { entry: GapEntry }) {
  const missed = typeof entry.missedCount === "number" ? entry.missedCount : null;
  return (
    <>
      <p>{defaultStrings.gap(missed, text(entry.reason))}</p>
      <Fields
        fields={[
          [labels.timestamp, text(entry.timestamp)],
          [labels.receivedAt, text(entry.receivedAt)],
        ]}
      />
    </>
  );
}

/**
 * The details of one entry: fields, payload, raw frame, error, meta and
 * viewer metadata, printed as plain text by a bounded printer (trace data is
 * never rendered as HTML), with links to the paired message.
 */
export function EntryInspector(props: EntryInspectorProps): ReactElement {
  const { store, entryId, correlator, onCopy, revealSensitive = false, className } = props;
  const sensitiveKeys = props.sensitiveKeys ?? defaultSensitiveKeys;
  useVersion(store);
  useVersion(correlator);
  const keys = useMemo(
    () => (revealSensitive ? null : sensitiveKeySet(sensitiveKeys)),
    [revealSensitive, sensitiveKeys],
  );
  const copy: DetailsProps["copy"] = (build, part) =>
    onCopy === undefined ? undefined : () => onCopy(build(), part);
  const entry = entryId === null ? undefined : store.get(entryId);

  let body: ReactNode;
  if (entryId === null) body = <p>{strings.empty}</p>;
  else if (entry === undefined) body = <p>{strings.gone}</p>;
  else if (entry.kind === "trace")
    body = <TraceDetails key={entryId} entry={entry} props={props} keys={keys} copy={copy} />;
  else if (entry.kind === "unparsed")
    body = <UnparsedDetails key={entryId} entry={entry} props={props} keys={keys} copy={copy} />;
  else body = <GapDetails entry={entry} />;

  return (
    <section
      className={className === undefined ? "oot-inspector" : `oot-inspector ${className}`}
      aria-label={strings.label}
    >
      {body}
    </section>
  );
}
