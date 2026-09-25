import { EditorState, TextSelection } from "prosemirror-state";
import { describe, expect, it } from "vite-plus/test";

import {
  activeTrigger,
  deleteAtom,
  parseProse,
  proseSliceFromText,
  serializeProse,
} from "@/lib/prose-doc";

const FIRE = "<:fire:123456789012345678>";
const roundTrip = (value: string, mentions = false) =>
  serializeProse(parseProse(value, { mentions }).content);

describe("prose document", () => {
  it("round-trips the stored text", () => {
    for (const value of [
      "",
      "plain",
      `so hot ${FIRE} right\n\nnow <a:party:998877665544332211>`,
      "thanks @someone!",
      "```\ncode <:fire:123456789012345678>\n```\nafter",
    ]) {
      expect(roundTrip(value, true)).toBe(value);
    }
  });

  it("makes emojis and mentions atoms, outside code only", () => {
    const doc = parseProse(`a ${FIRE} @someone \`${FIRE}\``, { mentions: true });
    const types: string[] = [];
    doc.descendants((node) => {
      if (node.isInline) types.push(node.type.name);
    });
    expect(types).toEqual(["text", "emoji", "text", "mention", "text"]);
  });

  it("leaves @handles as text without mentions", () => {
    const doc = parseProse("hi @someone");
    expect(doc.firstChild!.childCount).toBe(1);
  });

  it("parses pasted text into atoms", () => {
    const slice = proseSliceFromText(`hey\r\n${FIRE}`, {});
    expect(serializeProse(slice.content)).toBe(`hey\n${FIRE}`);
  });
});

function stateAt(value: string, pos?: number) {
  const doc = parseProse(value, { mentions: true });
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos ?? doc.content.size - 1)));
}

describe("editor commands", () => {
  it("backspace removes a whole emoji", () => {
    let state = stateAt(`hot ${FIRE}`);
    deleteAtom(-1)(state, (tr) => (state = state.apply(tr)));
    expect(serializeProse(state.doc.content)).toBe("hot ");
  });

  it("backspace removes a whole mention", () => {
    let state = stateAt("hi @someone");
    deleteAtom(-1)(state, (tr) => (state = state.apply(tr)));
    expect(serializeProse(state.doc.content)).toBe("hi ");
  });

  it("leaves plain characters to the default backspace", () => {
    expect(deleteAtom(-1)(stateAt("hi"))).toBe(false);
  });

  it("finds the trigger with its document range", () => {
    expect(activeTrigger(stateAt("so :fi"))).toMatchObject({ kind: "emoji", from: 4, to: 7 });
  });

  it("treats an emoji before the trigger as a boundary", () => {
    expect(activeTrigger(stateAt(`${FIRE}:ke`))).toMatchObject({ kind: "emoji", query: "ke" });
    expect(activeTrigger(stateAt("x:ke"))).toBeNull();
  });
});
