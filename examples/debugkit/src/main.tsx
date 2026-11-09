// First: DebugKit needs `Buffer.byteLength`, which browsers lack.
import "./buffer-shim.ts";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@open-ocpp-trace/viewer-react/styles.css";

import { App } from "./App.tsx";
import "./app.css";
import { createExampleStore } from "./example-store.ts";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("the example page has no #root element");
}

// The store is filled before the first render, so StrictMode's double
// mount never loads the fixtures twice.
void createExampleStore().then((store) => {
  createRoot(container).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
});
