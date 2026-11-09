import { createContext, useContext, useMemo } from "react";

import { reportViewerError, type ViewerErrorHandler } from "@open-ocpp-trace/viewer-core";

import { useStableCallback } from "./hooks.ts";
import {
  defaultStrings,
  type PartialViewerStrings,
  stringParams,
  type TranslateFunction,
  type ViewerStrings,
} from "./strings.ts";

type Params = Readonly<Record<string, string | number | null>>;
type Leaf = (...args: never[]) => string;

const NO_PARAMS: Params = Object.freeze({});

/** Receives an error thrown by `translate`. */
type ReportFunction = (error: unknown) => void;

const reportByDefault: ReportFunction = (error) =>
  reportViewerError(undefined, error, { component: "strings", callback: "translate" });

/**
 * The strings resolved by the nearest `<TraceViewer>` (or standalone
 * component given `strings` or `translate`), read by everything it renders.
 */
export const StringsContext = createContext<ViewerStrings>(defaultStrings);

/** `translate`'s text for `key`, or undefined; a throw is reported. */
function translated(
  translate: TranslateFunction | undefined,
  key: string,
  params: Params,
  report: ReportFunction,
): string | undefined {
  if (translate === undefined) return undefined;
  try {
    const text = translate(key, params);
    return typeof text === "string" ? text : undefined;
  } catch (error) {
    report(error);
    return undefined;
  }
}

/** Reads an override without trusting its shape. */
function child(override: unknown, name: string): unknown {
  return typeof override === "object" && override !== null
    ? (override as Readonly<Record<string, unknown>>)[name]
    : undefined;
}

function resolveFunction(
  key: string,
  fallback: Leaf,
  own: unknown,
  translate: TranslateFunction | undefined,
  report: ReportFunction,
): Leaf {
  const base = (typeof own === "function" ? own : fallback) as (...args: unknown[]) => string;
  if (translate === undefined) return base;
  const names = stringParams[key] ?? [];
  return (...args: unknown[]): string => {
    const params: Record<string, string | number | null> = {};
    names.forEach((name, index) => {
      params[name] = args[index] as string | number | null;
    });
    return translated(translate, key, params, report) ?? base(...args);
  };
}

function resolveNode(
  defaults: object,
  override: unknown,
  translate: TranslateFunction | undefined,
  prefix: string,
  report: ReportFunction,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(defaults)) {
    const key = `${prefix}${name}`;
    const own = child(override, name);
    if (typeof value === "string") {
      resolved[name] =
        translated(translate, key, NO_PARAMS, report) ?? (typeof own === "string" ? own : value);
    } else if (typeof value === "function") {
      resolved[name] = resolveFunction(key, value as Leaf, own, translate, report);
    } else {
      resolved[name] = resolveNode(value as object, own, translate, `${key}.`, report);
    }
  }
  return resolved;
}

/**
 * The strings to show: per leaf, `translate(key, params)` when it returns a
 * string, else the `overrides` leaf, else the default. A throw of
 * `translate` goes to `report` (by default, the default reporter of
 * `reportViewerError`).
 */
export function resolveStrings(
  overrides: PartialViewerStrings | undefined,
  translate: TranslateFunction | undefined,
  report: ReportFunction = reportByDefault,
): ViewerStrings {
  if (overrides === undefined && translate === undefined) return defaultStrings;
  return resolveNode(defaultStrings, overrides, translate, "", report) as unknown as ViewerStrings;
}

/**
 * A component's strings: resolved from its own props when it has any,
 * memoized on their identity, else those of the enclosing viewer. A throw of
 * `translate` goes to the latest `onError` with `{ component, callback:
 * "translate" }`; a new `onError` identity resolves nothing again.
 */
export function useViewerStrings(
  overrides: PartialViewerStrings | undefined,
  translate: TranslateFunction | undefined,
  onError: ViewerErrorHandler | undefined,
  component: string,
): ViewerStrings {
  const inherited = useContext(StringsContext);
  const report = useStableCallback((error: unknown): void =>
    reportViewerError(onError, error, { component, callback: "translate" }),
  );
  const own = useMemo(
    () =>
      overrides === undefined && translate === undefined
        ? null
        : resolveStrings(overrides, translate, report),
    [overrides, translate, report],
  );
  return own ?? inherited;
}

/** The strings of the enclosing component. */
export function useStrings(): ViewerStrings {
  return useContext(StringsContext);
}
