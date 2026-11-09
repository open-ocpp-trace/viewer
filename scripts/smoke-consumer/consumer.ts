// Type-checked with `tsc --noEmit` in a throwaway project that installed
// the packed tarballs, once per module resolution mode and per React
// version. Reaches types and values through every package entry point, as a
// consumer does, so a tarball whose `types` entry does not resolve fails.

import { VIEWER_CORE_VERSION } from "@open-ocpp-trace/viewer-core";
import { VIEWER_REACT_VERSION, hostReactVersion } from "@open-ocpp-trace/viewer-react";
import { VIEWER_STANDALONE_VERSION, bundledReactVersion } from "@open-ocpp-trace/viewer-standalone";

const versions: readonly string[] = [
  VIEWER_CORE_VERSION,
  VIEWER_REACT_VERSION,
  VIEWER_STANDALONE_VERSION,
];
const react: string = hostReactVersion();
const bundled: string = bundledReactVersion();

export const summary: string = [...versions, react, bundled].join(" ");
