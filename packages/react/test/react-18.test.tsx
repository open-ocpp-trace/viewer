import { fireEvent, render, screen } from "@testing-library/react";
import { useState, version, type ReactElement } from "react";
import { version as domVersion } from "react-dom";
import { describe, expect, it } from "vite-plus/test";

// Collected by the `react18` project only: it proves that this project runs
// the React tests against one React 18, Testing Library included.
describe("the react18 test project", () => {
  it("imports React 18 and React DOM 18", () => {
    expect(version.startsWith("18.")).toBe(true);
    expect(domVersion.startsWith("18.")).toBe(true);
  });

  it("renders hooks through Testing Library with that same React", () => {
    function Counter(): ReactElement {
      const [count, setCount] = useState(0);
      return (
        <button type="button" onClick={() => setCount(count + 1)}>
          {count}
        </button>
      );
    }
    render(<Counter />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("1");
  });
});
