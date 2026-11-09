import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

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

/** The engine's version, re-rendering the component on every change. */
export function useEngineVersion(engine: FilterEngine): number {
  const subscribe = useCallback((onChange: () => void) => engine.subscribe(onChange), [engine]);
  const version = (): number => engine.version;
  return useSyncExternalStore(subscribe, version, version);
}
