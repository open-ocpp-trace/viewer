import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@open-ocpp-trace/viewer-react/styles.css";
import { VIEWER_REACT_VERSION, hostReactVersion } from "@open-ocpp-trace/viewer-react";

import { BrandedExample } from "./BrandedExample.tsx";
import "./page.css";
import { PlainExample } from "./PlainExample.tsx";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the playground page has no #root element");
}

createRoot(container).render(
  <StrictMode>
    <main className="playground">
      <p className="playground__version">
        viewer-react {VIEWER_REACT_VERSION} on React {hostReactVersion()}
      </p>
      <div className="playground__examples">
        <PlainExample />
        <BrandedExample />
      </div>
    </main>
  </StrictMode>,
);
