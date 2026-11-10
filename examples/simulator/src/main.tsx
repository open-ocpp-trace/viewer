import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@open-ocpp-trace/viewer-react/styles.css";

import "./page.css";
import { SimulatorExample } from "./SimulatorExample.tsx";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the simulator example page has no #root element");
}

createRoot(container).render(
  <StrictMode>
    <SimulatorExample />
  </StrictMode>,
);
