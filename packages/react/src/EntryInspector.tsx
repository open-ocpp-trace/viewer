import { Fragment, memo, type ReactElement, type ReactNode, useMemo, useState } from "react";

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
  type FormatMarkers,
  type Formatted,
  formatValue,
  sensitiveKeySet,
} from "./inspect-format.ts";
import { useVersion } from "./hooks.ts";
import { ResetBoundary } from "./reset-boundary.tsx";
import type { PartialViewerStrings, TranslateFunction, ViewerStrings } from "./strings.ts";
import { StringsContext, useStrings, useViewerStrings } from "./strings-context.ts";

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
   * printed on click without the `maxChars` limit, sensitive fields redacted,
   * with the same `inspector.markers` as the blocks. A printed block is capped at 50 000 000 characters (an adapter object
   * that shares references can print exponentially); past it, the text is
   * cut and ends with `"\n…[truncated]"`. The raw frame is copied as is.
   */
  onCopy?: (text: string, part: InspectorPart) => void;
  /**
   * Renders the printed payload text (syntax highlighting); its output is
   * placed in the payload block. Not used for a truncated payload; a throw
   * falls back to the plain text until the renderer or the text changes.
   * Memoize it. `entry` is the untouched entry, sensitive fields included;
   * render `text` to keep the redaction.
   */
  renderPayload?: (text: string, entry: TraceEntry) => ReactNode;
  /**
   * Shows the values of sensitive fields, otherwise printed `"[redacted]"`
   * (`inspector.markers.redacted`).
   * While they are hidden and `sensitiveKeys` is not empty, raw frames fail
   * closed: the raw frame of an unparsed entry is never shown, and the raw
   * frame of a record only when its payload (and the error details of a
   * CALLERROR) is present and, like its meta when present, was printed in
   * full with nothing redacted, truncated, cut at the depth limit or
   * unreadable, and the frame (up to 1 000 000 characters, longer ones are
   * hidden) holds no quoted sensitive key followed by `:`. Value-based secrets (a `SetVariables` value whose variable
   * is `BasicAuthPassword`) are not detected.
   */
  revealSensitive?: boolean;
  /** Property names to redact, case-insensitively; default `defaultSensitiveKeys`. Memoize it. */
  sensitiveKeys?: readonly string[];
  /** Initial printed length of each block; « Show more » multiplies it by 4. Default 20 000. */
  maxChars?: number;
  /** Overrides of `defaultStrings`, as `TraceViewerProps.strings`. */
  strings?: PartialViewerStrings;
  /** Translates the strings, as `TraceViewerProps.translate`. */
  translate?: TranslateFunction;
  className?: string;
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

/** Longest plain field rendered; longer values are clipped and end with « … ». */
const FIELD_MAX = 1024;
/** Longest copied block, marker included; bounds a copy of shared references. */
const COPY_MAX = 50_000_000;
const COPY_TRUNCATED = "\n…[truncated]";

function clip(value: string): string {
  return value.length > FIELD_MAX ? `${value.slice(0, FIELD_MAX)}…` : value;
}

/** A string or number field as clipped text, otherwise null. */
function text(value: unknown): string | null {
  if (typeof value === "string") return clip(value);
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
          <dd>{value === null ? null : clip(value)}</dd>
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
  const strings = useStrings().inspector;
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

function rawBlock(
  raw: string,
  limits: ReturnType<typeof useLimits>,
  copy: DetailsProps["copy"],
  strings: ViewerStrings,
) {
  const limit = limits.limit("raw");
  const printed = { text: raw.slice(0, limit), truncated: raw.length > limit };
  return (
    <Block
      title={strings.inspector.blocks.raw}
      printed={printed}
      onMore={limits.more("raw")}
      onCopy={copy(() => raw, "raw")}
      total={raw.length}
    />
  );
}

/** Sensitive fields are hidden and at least one key is sensitive. */
function redacting(keys: ReadonlySet<string> | null): keys is ReadonlySet<string> {
  return keys !== null && keys.size > 0;
}

/** Present and printed in full: nothing redacted, truncated, elided or unreadable. */
function whole(printed: Formatted | null): boolean {
  return (
    printed !== null &&
    printed.redactedCount === 0 &&
    !printed.truncated &&
    !printed.elided &&
    !printed.unreadable
  );
}

/** Longest raw frame scanned for sensitive keys; a longer one is hidden. */
const RAW_SCAN_MAX = 1_000_000;

/**
 * The raw frame may hold a sensitive key the decoded parts lack: it is
 * longer than {@link RAW_SCAN_MAX}, or holds `"<key>"` followed by optional
 * whitespace and `:`, case-insensitively. A key spelled with JSON escapes
 * (`"idTag"`) is not detected.
 */
function rawMayHoldKey(raw: string, keys: ReadonlySet<string>): boolean {
  if (raw.length > RAW_SCAN_MAX) return true;
  const lower = raw.toLowerCase();
  for (const key of keys) {
    const quoted = `"${key}"`;
    for (let at = lower.indexOf(quoted); at !== -1; at = lower.indexOf(quoted, at + 1)) {
      let next = at + quoted.length;
      while (/\s/.test(lower.charAt(next))) next++;
      if (lower.charAt(next) === ":") return true;
    }
  }
  return false;
}

function rawHiddenNote(strings: ViewerStrings) {
  return <p className="oot-inspector__note">{strings.inspector.rawHidden}</p>;
}

function usePrinted(
  value: unknown,
  limit: number,
  keys: ReadonlySet<string> | null,
  markers: FormatMarkers,
) {
  return useMemo(
    () =>
      value === undefined
        ? null
        : formatValue(value, {
            maxChars: limit,
            maxDepth: DEFAULT_MAX_DEPTH,
            sensitiveKeys: keys,
            markers,
          }),
    [value, limit, keys, markers],
  );
}

/** The first 64 deliveries, one per line; null when absent or unreadable. */
function deliveriesText(deliveries: unknown, strings: ViewerStrings): string | null {
  if (!Array.isArray(deliveries)) return null;
  try {
    return deliveries
      .slice(0, 64)
      .map((d) =>
        strings.inspector.delivery(
          text(read(d, "target")) ?? "",
          text(read(d, "role")),
          text(read(d, "status")) ?? "",
          text(read(d, "reason")),
          text(read(d, "updatedAt")),
        ),
      )
      .join("\n");
  } catch {
    return null;
  }
}

/** Like {@link text}, unclipped: the raw block slices the frame itself. */
function rawText(value: unknown): string | null {
  if (typeof value === "string") return value;
  return typeof value === "number" ? String(value) : null;
}

/** The whole block for a copy, up to {@link COPY_MAX} characters. */
function copyText(
  value: unknown,
  keys: ReadonlySet<string> | null,
  markers: FormatMarkers,
): string {
  const printed = formatValue(value, {
    maxChars: COPY_MAX - COPY_TRUNCATED.length,
    maxDepth: DEFAULT_MAX_DEPTH,
    sensitiveKeys: keys,
    markers,
  });
  return printed.truncated ? printed.text + COPY_TRUNCATED : printed.text;
}

function TraceDetails({ entry, props, keys, copy }: DetailsProps & { entry: TraceEntry }) {
  const all = useStrings();
  const strings = all.inspector;
  const labels = strings.fields;
  const record = read(entry, "record");
  const metadata = read(entry, "metadata");
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
    payload: usePrinted(values.payload, limits.limit("payload"), keys, strings.markers),
    error: usePrinted(values.error, limits.limit("error"), keys, strings.markers),
    meta: usePrinted(values.meta, limits.limit("meta"), keys, strings.markers),
    custom: usePrinted(values.custom, limits.limit("custom"), keys, strings.markers),
  };
  const raw = rawText(read(record, "raw"));
  const rawHoldsKey = useMemo(
    () => raw !== null && redacting(keys) && rawMayHoldKey(raw, keys),
    [raw, keys],
  );
  // Fails closed: the raw frame is shown only when every decoded part it
  // holds was printed whole, so nothing a key would redact can hide in it,
  // and the frame itself names no sensitive key (payload and raw may differ).
  const rawHidden =
    redacting(keys) &&
    (rawHoldsKey ||
      !whole(printed.payload) ||
      (fields.messageType === "CALLERROR" && !whole(printed.error)) ||
      (printed.meta !== null && !whole(printed.meta)));
  const source = read(metadata, "source");
  const sourceId = text(read(source, "id"));
  const delivered = deliveriesText(read(metadata, "deliveries"), all);

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
            : copy(() => copyText(values[name], keys, strings.markers), part)
        }
      >
        {name === "payload" && render !== undefined && !shown.truncated ? (
          <ResetBoundary key={limits.step(name)} fallback={plain} resetKeys={[render, shown.text]}>
            <Code title={title}>
              <HostPayload render={render} text={shown.text} entry={entry} />
            </Code>
          </ResetBoundary>
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
          [labels.receivedAt, text(read(entry, "receivedAt"))],
          [labels.errorCode, text(read(error, "code"))],
          [labels.errorDescription, text(read(error, "description"))],
        ]}
      />
      <Pairing entry={entry} props={props} />
      {block("error", "error")}
      {block("payload", "payload")}
      {raw !== null && (rawHidden ? rawHiddenNote(all) : rawBlock(raw, limits, copy, all))}
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
  const strings = useStrings().inspector;
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

function UnparsedDetails({ entry, props, keys, copy }: DetailsProps & { entry: UnparsedEntry }) {
  const limits = useLimits(props.maxChars ?? 20_000);
  const all = useStrings();
  const labels = all.inspector.fields;
  return (
    <>
      <p className="oot-inspector__badge">{all.unparsed}</p>
      <Fields
        fields={[
          [labels.reason, text(read(entry, "reason"))],
          [labels.timestamp, text(read(entry, "timestamp"))],
          [labels.direction, text(read(entry, "direction"))],
          [labels.transport, text(read(entry, "transport"))],
          [labels.receivedAt, text(read(entry, "receivedAt"))],
        ]}
      />
      {redacting(keys)
        ? rawHiddenNote(all)
        : rawBlock(rawText(read(entry, "raw")) ?? "", limits, copy, all)}
    </>
  );
}

function GapDetails({ entry }: { entry: GapEntry }) {
  const count = read(entry, "missedCount");
  const missed = typeof count === "number" ? count : null;
  const all = useStrings();
  const labels = all.inspector.fields;
  return (
    <>
      <p>{all.gap(missed, text(read(entry, "reason")))}</p>
      <Fields
        fields={[
          [labels.timestamp, text(read(entry, "timestamp"))],
          [labels.receivedAt, text(read(entry, "receivedAt"))],
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
  const allStrings = useViewerStrings(props.strings, props.translate);
  const strings = allStrings.inspector;
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
    <StringsContext.Provider value={allStrings}>
      <section
        className={className === undefined ? "oot-inspector" : `oot-inspector ${className}`}
        aria-label={strings.label}
      >
        {body}
      </section>
    </StringsContext.Provider>
  );
}
