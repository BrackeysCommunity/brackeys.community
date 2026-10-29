// @vitest-environment jsdom
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import { CardTextEditor } from "../CardTextEditor";

vi.mock("@/components/ui/text-suggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/text-suggestions")>()),
  useTextSuggestions: () => ({
    live: null,
    suggestions: [],
    active: 0,
    emojis: [],
    unicodeEmojis: [],
    setActive() {},
    move() {},
    dismiss() {},
  }),
}));

beforeAll(() => {
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = rects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.getClientRects = rects;
});
afterEach(() => cleanup());

function mount(body: string) {
  const doc = new Y.Doc();
  const text = doc.getText("t");
  text.insert(0, body);
  const { container } = render(<CardTextEditor text={text} onDone={() => {}} />);
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
  return { text, view };
}

function clipboardEvent(type: "paste" | "drop", text: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const data = {
    getData: (t: string) => (t === "text/plain" || t === "Text" ? text : ""),
    files: [] as File[],
    types: ["text/plain"],
  };
  Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", {
    value: data,
  });
  Object.assign(event, { clientX: 0, clientY: 0 });
  return event;
}

describe("CardTextEditor line breaks on paste and drop", () => {
  it("normalises CR CR LF runs and a paste over a selection", () => {
    const { text, view } = mount("keep REPLACE end");
    const from = view.state.doc.toString().indexOf("REPLACE");
    view.dispatch({ selection: EditorSelection.range(from, from + "REPLACE".length) });
    view.contentDOM.dispatchEvent(clipboardEvent("paste", "a\r\r\nb\r\n\r\nc\r"));
    expect(text.toJSON()).toBe("keep a\n\nb\n\nc\n end");
    expect(text.toJSON()).not.toContain("\r");
    expect(view.state.doc.length).toBe(text.length);
  });

  it("normalises a dropped text with CRLF", () => {
    const { text, view } = mount("");
    view.contentDOM.dispatchEvent(clipboardEvent("drop", "x\r\ny\rz"));
    expect(text.toJSON()).toBe("x\ny\nz");
  });

  it("a later edit after a pasted break lands where it was made", () => {
    const { text, view } = mount("");
    view.contentDOM.dispatchEvent(clipboardEvent("paste", "one\r\ntwo"));
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(text.toJSON()).toBe("one\ntwo!");
  });
});

const command = (key: string) => yUndoManagerKeymap.find((b) => b.key === key)!.run!;

describe("CardTextEditor with a CRLF body", () => {
  it("restores the exact bytes on undo and redoes the edit exactly", async () => {
    const body = "\uFEFFa  \r\nb\r\n\r\nc\rd\n";
    const { text, view } = mount(body);
    const at = view.state.doc.toString().indexOf("c");
    view.dispatch({ changes: { from: at, to: at + 1, insert: "C!" } });
    const edited = "\uFEFFa  \r\nb\r\n\r\nC!\rd\n";
    expect(text.toJSON()).toBe(edited);
    await new Promise((r) => setTimeout(r, 0));
    expect(command("Mod-z")(view)).toBe(true);
    expect(text.toJSON()).toBe(body);
    expect(view.state.doc.toString()).toBe(body);
    expect(command("Mod-y")(view)).toBe(true);
    expect(text.toJSON()).toBe(edited);
    expect(view.state.doc.toString()).toBe(edited);
  });

  it("keeps a remote CRLF edit in step with the open editor", () => {
    const { text, view } = mount("one\r\ntwo");
    text.insert(0, "zero\r\n");
    expect(view.state.doc.toString()).toBe("zero\r\none\r\ntwo");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(text.toJSON()).toBe("zero\r\none\r\ntwo!");
  });
});
