/** Where a reported error was caught. */
export interface ViewerErrorContext {
  /**
   * The viewer part that caught the error: "store", "correlator",
   * "filterEngine" in core; React component names in viewer-react.
   */
  readonly component: string;
  /** The callback or step that threw, e.g. "listener", "snapshot", "follow". */
  readonly callback: string;
}

/**
 * Receives the errors a viewer part catches from host callbacks (listeners)
 * or from its own work, which no caller is left to receive.
 */
export type ViewerErrorHandler = (error: unknown, context: ViewerErrorContext) => void;

/** The globals the default reporter uses, when the host provides them. */
interface ReportingHost {
  readonly reportError?: unknown;
  readonly console?: { readonly error?: unknown };
}

/** Last resort: `console.error`, if there is one; never throws. */
function logError(error: unknown): void {
  try {
    const host = globalThis as ReportingHost;
    const log = host.console?.error;
    if (typeof log === "function") log.call(host.console, error);
  } catch {
    // Nowhere left to report to.
  }
}

/**
 * The default reporter: `globalThis.reportError` when it is a function at
 * this moment, else `console.error`; never throws.
 */
function reportDefault(error: unknown): void {
  try {
    const report = (globalThis as ReportingHost).reportError;
    if (typeof report === "function") {
      report.call(globalThis, error);
      return;
    }
  } catch {
    // The host reporter failed: fall back to the console.
  }
  logError(error);
}

/**
 * Reports `error`, synchronously, and never throws. With `onError`, calls
 * it with `error` and `context`. Without it, the default reporter receives
 * `error`: `globalThis.reportError` if it is a function when reporting,
 * else `console.error`. If `onError` throws, the default reporter receives
 * `error`, then the handler's error, once each, and `onError` is not called
 * again for them. If the default reporter throws, `console.error` receives
 * `error` as a last resort.
 */
export function reportViewerError(
  onError: ViewerErrorHandler | undefined,
  error: unknown,
  context: ViewerErrorContext,
): void {
  if (onError === undefined) {
    reportDefault(error);
    return;
  }
  try {
    onError(error, context);
  } catch (handlerError) {
    reportDefault(error);
    reportDefault(handlerError);
  }
}
