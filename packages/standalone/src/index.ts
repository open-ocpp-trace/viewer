import { hostReactVersion } from "@open-ocpp-trace/viewer-react";

/** Version of the `@open-ocpp-trace/viewer-standalone` package. */
export const VIEWER_STANDALONE_VERSION: string = "0.0.0";

/** Version of the React copy bundled into this package. */
export function bundledReactVersion(): string {
  return hostReactVersion();
}

export { mount } from "./mount.ts";
export type { MountOnlyOptions, MountOptions, ViewerInstance } from "./mount.ts";
