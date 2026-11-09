import { version } from "react";

/** Version of the `@open-ocpp-trace/viewer-react` package. */
export const VIEWER_REACT_VERSION: string = "0.0.0";

/** Version of the React copy the host application provides. */
export function hostReactVersion(): string {
  return version;
}

export { useFilterEngine } from "./hooks.ts";
export { TraceList } from "./TraceList.tsx";
export type { TraceListProps } from "./TraceList.tsx";
