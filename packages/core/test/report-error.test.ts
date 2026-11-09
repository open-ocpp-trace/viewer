import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { reportViewerError, type ViewerErrorContext } from "@open-ocpp-trace/viewer-core";

const context: ViewerErrorContext = { component: "store", callback: "listener" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reportViewerError", () => {
  it("calls onError with the error and the context, and nothing else", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    const error = new Error("boom");

    reportViewerError(onError, error, context);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, context);
    expect(reportError).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("defaults to globalThis.reportError, looked up when reporting", () => {
    const early = vi.fn();
    vi.stubGlobal("reportError", early);
    const late = vi.fn();
    vi.stubGlobal("reportError", late);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");

    reportViewerError(undefined, error, context);

    expect(early).not.toHaveBeenCalled();
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(error);
    expect(log).not.toHaveBeenCalled();
  });

  it("defaults to console.error without a reportError function", () => {
    vi.stubGlobal("reportError", undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");

    reportViewerError(undefined, error, context);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(error);
  });

  it("reports synchronously", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    reportViewerError(undefined, "now", context);
    expect(reportError).toHaveBeenCalledWith("now");
  });

  it("reports a throwing onError's error and the original one to the default, once each", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const error = new Error("original");
    const handlerError = new Error("handler");
    const onError = vi.fn(() => {
      throw handlerError;
    });

    expect(() => reportViewerError(onError, error, context)).not.toThrow();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls).toEqual([[error], [handlerError]]);
  });

  it("falls back to console.error when reportError throws, letting nothing escape", () => {
    vi.stubGlobal("reportError", () => {
      throw new Error("reportError failed");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("boom");

    expect(() => reportViewerError(undefined, error, context)).not.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(error);
  });

  it("lets nothing escape when every reporter throws", () => {
    vi.stubGlobal("reportError", () => {
      throw new Error("reportError failed");
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("console failed");
    });
    const onError = (): never => {
      throw new Error("handler failed");
    };

    expect(() => reportViewerError(onError, new Error("boom"), context)).not.toThrow();
  });
});
