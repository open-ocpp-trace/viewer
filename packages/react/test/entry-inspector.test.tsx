import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createCorrelator,
  createViewerStore,
  type Correlator,
  type TraceEntry,
  type ViewerEntry,
  type ViewerStore,
} from "@open-ocpp-trace/viewer-core";
import { EntryInspector, type EntryInspectorProps } from "@open-ocpp-trace/viewer-react";

import { add, sdkEntry } from "./fixtures.ts";

interface Setup {
  store: ViewerStore;
  correlator: Correlator;
}

function setup(entries: ViewerEntry[], maxEntries?: number): Setup {
  const store = createViewerStore(maxEntries === undefined ? {} : { maxEntries });
  const correlator = createCorrelator();
  correlator.connect(store);
  store.load(entries);
  return { store, correlator };
}

function inspect(
  entries: ViewerEntry[],
  entryId: string | null,
  props: Partial<EntryInspectorProps> = {},
): Setup & { root: HTMLElement } {
  const state = setup(entries);
  render(<EntryInspector store={state.store} entryId={entryId} {...props} />);
  return { ...state, root: screen.getByRole("region", { name: "Entry details" }) };
}

/** The text of the field labelled `label` in a definition list, or null. */
function field(label: string): string | null {
  const term = screen.queryAllByText(label, { selector: "dt" })[0];
  return term?.nextElementSibling?.textContent ?? null;
}

function block(name: string): HTMLElement | null {
  return screen.queryByLabelText(name, { selector: "pre" });
}

const FULL = {
  raw: '[2,"m-a","Heartbeat",{}]',
  payload: { note: "hello" },
  meta: { producer: "gw" },
};
const METADATA = {
  tenant: "t-1",
  sessionId: "s-1",
  conversationId: "conv-1",
  source: { id: "src-1", label: "Gateway" },
  deliveries: [
    { target: "csms-a", role: "primary", status: "dropped", reason: "closed", updatedAt: "T1" },
  ],
  custom: { lane: 3 },
};

function variant(messageType: string, full: boolean): TraceEntry {
  const error =
    messageType === "CALLERROR"
      ? { error: { code: "InternalError", description: "boom", details: { at: "x" } } }
      : {};
  const entry = sdkEntry("e", {
    messageType,
    ...(messageType === "CALL" ? {} : { action: undefined }),
    payload: undefined,
    ...error,
    ...(full && FULL),
  });
  return full ? { ...entry, receivedAt: "2026-11-09T10:00:01.000Z", metadata: METADATA } : entry;
}

describe("<EntryInspector>", () => {
  it("shows an empty state when nothing is selected", () => {
    const { root } = inspect([sdkEntry("a")], null);
    expect(root.textContent).toBe("No entry selected");
  });

  it("tells when the selected entry is not in the store, also after an eviction", () => {
    const { root, store } = inspect([sdkEntry("a")], "zzz");
    expect(root.textContent).toBe("This entry is no longer available");

    const evicting = setup([sdkEntry("a")], 1);
    const { container } = render(<EntryInspector store={evicting.store} entryId="a" />);
    expect(container.textContent).toContain("Heartbeat");
    act(() => evicting.store.apply([add(sdkEntry("b"))]));
    expect(container.textContent).toBe("This entry is no longer available");
    expect(store.size).toBe(1);
  });

  for (const messageType of ["CALL", "CALLRESULT", "CALLERROR"]) {
    it(`details a ${messageType} with raw, payload, meta and metadata`, () => {
      inspect([variant(messageType, true)], "e");
      expect(field("Type")).toBe(messageType);
      expect(field("Message ID")).toBe("m-e");
      expect(field("Charge point")).toBe("CP-1");
      expect(field("Direction")).toBe("cp-to-csms");
      expect(field("OCPP version")).toBe("1.6");
      expect(field("Transport")).toBe("json");
      expect(field("Timestamp")).toBe("2026-11-09T10:00:00.000Z");
      expect(field("Received at")).toBe("2026-11-09T10:00:01.000Z");
      expect(block("Payload")?.textContent).toBe('{\n  "note": "hello"\n}');
      expect(block("Raw frame")?.textContent).toBe(FULL.raw);
      expect(block("Meta")?.textContent).toBe('{\n  "producer": "gw"\n}');
      expect(field("Tenant")).toBe("t-1");
      expect(field("Source")).toBe("Gateway (src-1)");
      expect(field("Session")).toBe("s-1");
      expect(field("Conversation")).toBe("conv-1");
      expect(field("Deliveries")).toBe("csms-a (primary): dropped — closed at T1");
      expect(block("Custom metadata")?.textContent).toBe('{\n  "lane": 3\n}');
      if (messageType === "CALLERROR") {
        expect(field("Error code")).toBe("InternalError");
        expect(field("Error description")).toBe("boom");
        expect(block("Error details")?.textContent).toBe('{\n  "at": "x"\n}');
      } else {
        expect(field("Error code")).toBeNull();
        expect(block("Error details")).toBeNull();
      }
    });

    it(`details a ${messageType} without raw, payload, meta or metadata`, () => {
      inspect([variant(messageType, false)], "e");
      expect(field("Type")).toBe(messageType);
      expect(field("Action")).toBe(messageType === "CALL" ? "Heartbeat" : null);
      for (const name of ["Payload", "Raw frame", "Meta", "Custom metadata"]) {
        expect(block(name)).toBeNull();
      }
      expect(field("Received at")).toBeNull();
      expect(field("Tenant")).toBeNull();
      expect(field("Deliveries")).toBeNull();
    });
  }

  it("shows the action a response derives from its CALL", () => {
    const call = sdkEntry("c", { messageId: "m1", action: "Authorize" });
    const response = sdkEntry("r", {
      messageId: "m1",
      messageType: "CALLRESULT",
      direction: "csms-to-cp",
      action: undefined,
    });
    const { store, correlator } = setup([call, response]);
    render(<EntryInspector store={store} correlator={correlator} entryId="r" />);
    expect(field("Action")).toBe("Authorize");
  });

  it("details an unparsed entry", () => {
    inspect(
      [
        {
          kind: "unparsed",
          id: "u",
          raw: "not json <b>",
          reason: "invalid JSON",
          timestamp: "T0",
          direction: "csms-to-cp",
          transport: "json",
        },
      ],
      "u",
      { revealSensitive: true },
    );
    expect(screen.getByText("Unparsed")).toBeTruthy();
    expect(field("Reason")).toBe("invalid JSON");
    expect(field("Timestamp")).toBe("T0");
    expect(field("Direction")).toBe("csms-to-cp");
    expect(field("Transport")).toBe("json");
    expect(block("Raw frame")?.textContent).toBe("not json <b>");
  });

  it("details a gap", () => {
    const { root } = inspect(
      [{ kind: "gap", id: "g", reason: "disconnected", missedCount: 12, timestamp: "T0" }],
      "g",
    );
    expect(root.textContent).toContain("Gap: 12 entries missed (disconnected)");
    expect(field("Timestamp")).toBe("T0");
  });
});

describe("<EntryInspector> paired navigation", () => {
  const call = sdkEntry("c", { messageId: "m1", action: "Authorize" });
  const response = sdkEntry("r", {
    messageId: "m1",
    messageType: "CALLRESULT",
    direction: "csms-to-cp",
  });
  const second = sdkEntry("r2", {
    messageId: "m1",
    messageType: "CALLRESULT",
    direction: "csms-to-cp",
  });

  function navigate(entryId: string, evictCall = false) {
    const { store, correlator } = setup([call, response, second], 3);
    // Evicted in a later batch: the correlator never pairs an entry added
    // and evicted in one batch.
    if (evictCall) store.apply([add(sdkEntry("later"))]);
    const onNavigate = vi.fn();
    render(
      <EntryInspector
        store={store}
        correlator={correlator}
        entryId={entryId}
        onNavigate={onNavigate}
      />,
    );
    return onNavigate;
  }

  it("goes from a CALL to its response", () => {
    const onNavigate = navigate("c");
    fireEvent.click(screen.getByRole("button", { name: "Go to response" }));
    expect(onNavigate).toHaveBeenCalledWith("r");
  });

  it("goes from a response to its CALL", () => {
    const onNavigate = navigate("r");
    fireEvent.click(screen.getByRole("button", { name: "Go to CALL" }));
    expect(onNavigate).toHaveBeenCalledWith("c");
  });

  it("lists the candidates of an orphan response", () => {
    const onNavigate = navigate("r2");
    expect(screen.getByText("No matching CALL")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Candidate 1" }));
    expect(onNavigate).toHaveBeenCalledWith("c");
  });

  it("renders a link to an evicted entry as disabled text", () => {
    navigate("r", true);
    expect(screen.queryByRole("button", { name: "Go to CALL" })).toBeNull();
    expect(screen.getByText("Go to CALL").getAttribute("aria-disabled")).toBe("true");
  });

  it("renders no link without onNavigate or without a correlator", () => {
    const { store, correlator } = setup([call, response]);
    const { rerender } = render(
      <EntryInspector store={store} correlator={correlator} entryId="c" />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<EntryInspector store={store} entryId="c" onNavigate={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("<EntryInspector> blocks", () => {
  const long = sdkEntry("l", { payload: { text: "y".repeat(1000), idTag: "SECRET" }, raw: "R" });

  it("renders no copy button without onCopy", () => {
    inspect([variant("CALLERROR", true)], "e");
    expect(screen.queryByRole("button", { name: /^Copy/ })).toBeNull();
  });

  it("copies the full, redacted text of a block", () => {
    const onCopy = vi.fn();
    inspect([long], "l", { onCopy, maxChars: 100 });
    expect(block("Payload")!.textContent!.length).toBeLessThanOrEqual(100);
    fireEvent.click(screen.getByRole("button", { name: "Copy Payload" }));
    const [text, part] = onCopy.mock.calls[0]!;
    expect(part).toBe("payload");
    expect(text).toBe(`{\n  "text": "${"y".repeat(1000)}",\n  "idTag": "[redacted]"\n}`);
  });

  it("copies the raw frame and the error details", () => {
    const onCopy = vi.fn();
    inspect([variant("CALLERROR", true)], "e", { onCopy });
    fireEvent.click(screen.getByRole("button", { name: "Copy Raw frame" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Error details" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Meta" }));
    expect(onCopy.mock.calls).toEqual([
      [FULL.raw, "raw"],
      ['{\n  "at": "x"\n}', "error"],
      ['{\n  "producer": "gw"\n}', "meta"],
    ]);
  });

  it("grows a truncated block with Show more", () => {
    inspect([long], "l", { maxChars: 100, revealSensitive: true });
    expect(block("Payload")!.textContent!.length).toBe(100);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(block("Payload")!.textContent!.length).toBe(400);
  });

  it("resets Show more when another entry is selected", () => {
    const other = sdkEntry("l2", { payload: { text: "z".repeat(1000) } });
    const { store } = setup([long, other]);
    const props = { store, maxChars: 100, revealSensitive: true };
    const { rerender } = render(<EntryInspector {...props} entryId="l" />);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(block("Payload")!.textContent!.length).toBe(400);
    rerender(<EntryInspector {...props} entryId="l2" />);
    expect(block("Payload")!.textContent!.length).toBe(100);
  });

  it("shows the total size of a truncated raw frame", () => {
    const raw = "r".repeat(1000);
    inspect([sdkEntry("w", { raw })], "w", { maxChars: 100 });
    expect(block("Raw frame")!.textContent).toBe("r".repeat(100));
    expect(screen.getByText("1000 characters in total")).toBeTruthy();
  });

  it("hides sensitive fields and the raw frame by default", () => {
    const entry = sdkEntry("s", {
      action: "Authorize",
      payload: { idTag: "SECRET" },
      raw: '[2,"m-s","Authorize",{"idTag":"SECRET"}]',
      meta: { password: "PW" },
    });
    const { root } = inspect([{ ...entry, metadata: { custom: { IdToken: "TOK" } } }], "s");
    expect(root.textContent).not.toMatch(/SECRET|PW|TOK/);
    expect(block("Payload")!.textContent).toBe('{\n  "idTag": "[redacted]"\n}');
    expect(block("Raw frame")).toBeNull();
    expect(root.textContent).toContain("The raw frame is hidden: it may contain sensitive fields");
  });

  it("reveals sensitive fields on request", () => {
    const entry = sdkEntry("s", { payload: { idTag: "SECRET" }, raw: "RAW-SECRET" });
    inspect([entry], "s", { revealSensitive: true });
    expect(block("Payload")!.textContent).toContain("SECRET");
    expect(block("Raw frame")!.textContent).toBe("RAW-SECRET");
  });

  it("hides the raw frame when the payload was not printed whole", () => {
    inspect([long], "l", { maxChars: 100, sensitiveKeys: ["nothing"] });
    expect(block("Raw frame")).toBeNull();
    expect(
      screen.getByText("The raw frame is hidden: it may contain sensitive fields"),
    ).toBeTruthy();
  });

  it("redacts the host's sensitive keys instead of the default ones", () => {
    const entry = sdkEntry("s", { payload: { idTag: "VISIBLE", Foo: "HIDDEN" }, raw: "R" });
    inspect([entry], "s", { sensitiveKeys: ["foo"] });
    expect(block("Payload")!.textContent).toBe(
      '{\n  "idTag": "VISIBLE",\n  "Foo": "[redacted]"\n}',
    );
    expect(block("Raw frame")).toBeNull();
  });
});

describe("<EntryInspector> raw frame while sensitive fields are hidden", () => {
  const HIDDEN = "The raw frame is hidden: it may contain sensitive fields";
  const SECRET_RAW = '[2,"m-a","Authorize",{"idTag":"SECRET"}]';

  function expectRawHidden(): void {
    expect(block("Raw frame")).toBeNull();
    expect(screen.getByText(HIDDEN)).toBeTruthy();
  }

  /** Nests `depth` objects with a loop. */
  function deep(depth: number): unknown {
    let value: unknown = "bottom";
    for (let i = 0; i < depth; i++) value = { next: value };
    return value;
  }

  it("hides the raw frame of a record without a payload", () => {
    const { root } = inspect([sdkEntry("n", { payload: undefined, raw: SECRET_RAW })], "n");
    expectRawHidden();
    expect(root.textContent).not.toContain("SECRET");
  });

  it("hides the raw frame of an unparsed entry, shown on request", () => {
    const entry: ViewerEntry = { kind: "unparsed", id: "u", raw: SECRET_RAW, reason: "bad" };
    const { root } = inspect([entry], "u", { onCopy: () => {} });
    expectRawHidden();
    expect(root.textContent).not.toContain("SECRET");
    expect(screen.queryByRole("button", { name: "Copy Raw frame" })).toBeNull();

    const { store } = setup([entry]);
    render(<EntryInspector store={store} entryId="u" revealSensitive />);
    expect(block("Raw frame")!.textContent).toBe(SECRET_RAW);
  });

  it("hides the raw frame when the meta was not printed whole", () => {
    const entry = sdkEntry("m", { raw: "R", meta: { text: "y".repeat(1000) } });
    inspect([entry], "m", { maxChars: 100 });
    expectRawHidden();
  });

  it("hides the raw frame when the payload was cut at the depth limit", () => {
    inspect([sdkEntry("d", { payload: deep(70), raw: "R" })], "d");
    expectRawHidden();
  });

  it("hides the raw frame when a payload property could not be read", () => {
    const payload = {
      get bad(): never {
        throw new Error("boom");
      },
    };
    const record = { ...sdkEntry("g").record, payload, raw: "R" };
    inspect([{ kind: "trace", id: "g", record }], "g");
    expectRawHidden();
  });

  it("hides the raw frame of a CALLERROR without error details", () => {
    const entry = sdkEntry("e", {
      messageType: "CALLERROR",
      error: { code: "InternalError" },
      raw: "R",
    });
    inspect([entry], "e");
    expectRawHidden();
  });

  it("shows the raw frame when payload and meta were printed whole", () => {
    const entry = sdkEntry("c", { payload: { note: "hi" }, meta: { producer: "gw" }, raw: "R" });
    inspect([entry], "c");
    expect(block("Raw frame")!.textContent).toBe("R");
    expect(screen.queryByText(HIDDEN)).toBeNull();
  });

  it("shows the raw frame when no key is sensitive", () => {
    const entries: ViewerEntry[] = [
      sdkEntry("n", { payload: undefined, raw: SECRET_RAW }),
      { kind: "unparsed", id: "u", raw: SECRET_RAW, reason: "bad" },
    ];
    const { store } = setup(entries);
    const { rerender } = render(<EntryInspector store={store} entryId="n" sensitiveKeys={[]} />);
    expect(block("Raw frame")!.textContent).toBe(SECRET_RAW);
    rerender(<EntryInspector store={store} entryId="u" sensitiveKeys={[]} />);
    expect(block("Raw frame")!.textContent).toBe(SECRET_RAW);
  });
});

describe("<EntryInspector> renderPayload", () => {
  const entry = sdkEntry("p", { payload: { a: 1 } });

  it("renders the printed payload through the host", () => {
    const renderPayload = vi.fn((text: string) => <mark>{text}</mark>);
    inspect([entry], "p", { renderPayload });
    expect(block("Payload")!.querySelector("mark")?.textContent).toBe('{\n  "a": 1\n}');
    expect(renderPayload).toHaveBeenCalledWith(
      '{\n  "a": 1\n}',
      expect.objectContaining({ id: "p" }),
    );
  });

  it("keeps a truncated payload plain", () => {
    const renderPayload = vi.fn((text: string) => <mark>{text}</mark>);
    inspect([entry], "p", { renderPayload, maxChars: 5 });
    expect(renderPayload).not.toHaveBeenCalled();
    expect(block("Payload")!.textContent).toBe('{\n  "');
  });

  it("falls back to plain text when the host throws", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      inspect([entry], "p", {
        renderPayload: () => {
          throw new Error("highlighter");
        },
      });
      expect(block("Payload")!.textContent).toBe('{\n  "a": 1\n}');
    } finally {
      quiet.mockRestore();
    }
  });

  it("does not re-print when an unrelated entry is added", () => {
    const renderPayload = vi.fn((text: string) => text);
    const { store } = inspect([entry], "p", { renderPayload });
    const calls = renderPayload.mock.calls.length;
    act(() => store.apply([add(sdkEntry("other"))]));
    expect(store.size).toBe(2);
    expect(renderPayload.mock.calls.length).toBe(calls);
  });

  it("does not read the payload again when an unrelated entry is added", () => {
    let reads = 0;
    // Printing reads `a`; the payload object itself stays the same.
    const payload = {
      get a() {
        reads++;
        return 1;
      },
    };
    const record = { ...sdkEntry("g").record, payload };
    const { store } = inspect([{ kind: "trace", id: "g", record }], "g");
    expect(block("Payload")!.textContent).toBe('{\n  "a": 1\n}');
    const before = reads;
    act(() => store.apply([add(sdkEntry("other"))]));
    expect(store.size).toBe(2);
    expect(reads).toBe(before);
  });
});
