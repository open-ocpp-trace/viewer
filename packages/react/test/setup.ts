import { cleanup } from "@testing-library/react";
import { afterEach } from "vite-plus/test";

// Testing Library only cleans up by itself when test globals are enabled.
afterEach(() => {
  cleanup();
});
