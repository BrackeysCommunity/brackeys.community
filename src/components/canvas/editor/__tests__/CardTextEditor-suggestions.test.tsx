// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { CardTextEditor } from "../CardTextEditor";

const PARTY = { id: "123456789012345678", name: "partyblob", animated: false };

vi.mock("@/orpc/client", () => ({
  client: {},
  orpc: {
    listGuildEmojis: {
      queryOptions: () => ({ queryKey: ["guildEmojis"], queryFn: async () => [PARTY] }),
    },
    searchProfiles: {
      queryOptions: ({ input }: { input: { search: string } }) => ({
        queryKey: ["searchProfiles", input.search],
        queryFn: async () => [{ id: "u1", urlStub: "Goos", displayName: "Goos", avatarUrl: null }],
      }),
    },
  },
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
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <CardTextEditor text={text} onDone={() => {}} />
    </QueryClientProvider>,
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
  return { text, view, container };
}

function typeAtEnd(view: EditorView, insert: string) {
  act(() => {
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert }, selection: { anchor: end + insert.length } });
  });
}

function press(view: EditorView, key: string) {
  act(() => {
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("CardTextEditor suggestions", () => {
  it("offers guild emojis for `:` and inserts the token on Enter", async () => {
    const { text, view } = mount("hi ");
    typeAtEnd(view, ":party");
    expect(await screen.findByText(":partyblob:")).toBeTruthy();
    press(view, "Enter");
    expect(text.toJSON()).toBe("hi <:partyblob:123456789012345678> ");
  });

  it("offers members for `@` and inserts the lowercased handle", async () => {
    const { text, view } = mount("");
    typeAtEnd(view, "@go");
    expect(await screen.findByText("@Goos", undefined, { timeout: 2000 })).toBeTruthy();
    press(view, "Enter");
    expect(text.toJSON()).toBe("@goos ");
  });

  it("closes the list on Escape without leaving the editor", async () => {
    const onDone = vi.fn();
    const doc = new Y.Doc();
    const text = doc.getText("t");
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CardTextEditor text={text} onDone={onDone} />
      </QueryClientProvider>,
    );
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement)!;
    typeAtEnd(view, ":party");
    await screen.findByText(":partyblob:");
    press(view, "Escape");
    expect(screen.queryByText(":partyblob:")).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("draws a stored guild emoji as its image", () => {
    const { container } = mount("<:partyblob:123456789012345678>");
    expect(container.querySelector('img[alt=":partyblob:"]')).not.toBeNull();
  });
});
