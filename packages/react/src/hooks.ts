import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  createFilterEngine,
  type FilterEngine,
  type FilterEngineOptions,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";

/**
 * A {@link FilterEngine} connected to `store` while the component is
 * mounted. A new engine is created when `store`, `options.correlator`,
 * `options.fields` or `options.payloadSearch` changes identity: memoize
 * `fields` (and keep the correlator) across renders. The correlator must be
 * connected to the same store by the host.
 */
export function useFilterEngine(store: ViewerStore, options?: FilterEngineOptions): FilterEngine {
  const correlator = options?.correlator;
  const fields = options?.fields;
  const payloadSearch = options?.payloadSearch;
  const engine = useMemo(
    () =>
      createFilterEngine({
        ...(correlator !== undefined && { correlator }),
        ...(fields !== undefined && { fields }),
        ...(payloadSearch !== undefined && { payloadSearch }),
      }),
    // A new store gets a new engine, so the old one's list never shows.
    [store, correlator, fields, payloadSearch],
  );
  useEffect(() => engine.connect(store), [engine, store]);
  return engine;
}

/** `useLayoutEffect` in a browser; `useEffect` on a server, which warns on the former. */
export const useIsomorphicLayoutEffect: typeof useEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A function of stable identity calling the latest `callback`, so a host
 * that keeps it (in state, in an effect) never calls a stale render's one.
 */
export function useStableCallback<A extends unknown[], R>(
  callback: (...args: A) => R,
): (...args: A) => R {
  const latest = useRef(callback);
  useIsomorphicLayoutEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

/** A source of change notifications carrying a version number. */
interface VersionSource {
  subscribe(listener: () => void): () => void;
  readonly version: number;
}

/**
 * The version of `source` (a store, an engine, a correlator), re-rendering
 * the component on every change; `0` without a source.
 */
export function useVersion(source: VersionSource | undefined): number {
  const subscribe = useCallback(
    (onChange: () => void) => (source === undefined ? () => {} : source.subscribe(onChange)),
    [source],
  );
  const read = (): number => source?.version ?? 0;
  return useSyncExternalStore(subscribe, read, read);
}
