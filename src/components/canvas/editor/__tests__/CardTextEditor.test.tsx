// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
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
  // CodeMirror measures layout; jsdom has none.
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

describe("CardTextEditor on a body with CR line endings", () => {
  it("keeps CodeMirror's offsets in step with the Y.Text", () => {
    const { text, view } = mount("line1\r\nline2\r\nline3");
    expect(view.state.doc.length).toBe(text.length);
  });

  it("edits after a CRLF land where they were made", () => {
    const { text, view } = mount("line1\r\nline2\r\nline3");
    const at = view.state.doc.toString().indexOf("line3");
    view.dispatch({ changes: { from: at, insert: "X" } });
    view.dispatch({ changes: { from: 0, to: 1, insert: "L" } });
    expect(text.toJSON()).toBe("Line1\r\nline2\r\nXline3");
  });

  it("leaves a lone CR as a plain character", () => {
    const { text, view } = mount("a\rb  \nc");
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    expect(text.toJSON()).toBe("a\rb  \nc!");
  });
});

function paste(view: EditorView, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  view.contentDOM.dispatchEvent(event);
}

describe("CardTextEditor paste", () => {
  it("turns CRLF and lone CR line breaks into \\n", () => {
    const { text, view } = mount("start:");
    paste(view, "one\r\ntwo\rthree\n");
    expect(text.toJSON()).toBe("start:one\ntwo\nthree\n");
    expect(view.state.doc.length).toBe(text.length);
  });

  it("leaves CRLF already in an imported body alone", () => {
    const { text, view } = mount("a\r\nb");
    paste(view, "!");
    expect(text.toJSON()).toBe("a\r\nb!");
  });
});
