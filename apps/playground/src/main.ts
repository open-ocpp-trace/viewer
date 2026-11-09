import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { VIEWER_REACT_VERSION, hostReactVersion } from "@open-ocpp-trace/viewer-react";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the playground page has no #root element");
}

createRoot(container).render(
  createElement("p", null, `viewer-react ${VIEWER_REACT_VERSION} on React ${hostReactVersion()}`),
);
