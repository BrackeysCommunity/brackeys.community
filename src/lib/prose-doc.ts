import { type Fragment, type Node, Schema, Slice } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";

import { EMOJI_TOKEN_PATTERN, emojiToken, emojiUrl } from "@/lib/discord-emoji";
import { MENTION_PATTERN } from "@/lib/forum-mentions";
import { type TriggerMatch, findTrigger } from "@/lib/textarea-autocomplete";

/**
 * The editor's document: lines of text with two kinds of atom, a guild
 * emoji and an `@handle` mention. It round-trips to the plain markdown
 * source the rest of the app stores: one paragraph per line, emojis as
 * `<:name:id>`, mentions as `@handle`.
 */
export const proseSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
    emoji: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { id: {}, name: {}, animated: { default: false } },
      leafText: (node) => `:${node.attrs.name as string}:`,
      parseDOM: [
        {
          tag: "img[data-emoji-id]",
          getAttrs: (dom) => ({
            id: dom.getAttribute("data-emoji-id"),
            name: dom.getAttribute("data-emoji-name"),
            animated: dom.getAttribute("data-emoji-animated") === "true",
          }),
        },
      ],
      toDOM: (node) => [
        "img",
        {
          src: emojiUrl({ id: node.attrs.id as string, animated: node.attrs.animated as boolean }),
          alt: `:${node.attrs.name as string}:`,
          draggable: "false",
          "data-slot": "guild-emoji",
          "data-emoji-id": node.attrs.id as string,
          "data-emoji-name": node.attrs.name as string,
          "data-emoji-animated": String(node.attrs.animated),
        },
      ],
    },
    mention: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { handle: {}, label: { default: null } },
      leafText: (node) => `@${node.attrs.handle as string}`,
      parseDOM: [
        {
          tag: "span[data-mention]",
          getAttrs: (dom) => ({ handle: dom.getAttribute("data-mention") }),
        },
      ],
      toDOM: (node) => [
        "span",
        { "data-mention": node.attrs.handle as string },
        `@${(node.attrs.label as string | null) ?? (node.attrs.handle as string)}`,
      ],
    },
  },
});

const CODE_PATTERN = /(```[\s\S]*?```|`[^`\n]*`)/;

type Piece = string | Node;

function inlinePieces(text: string, mentions: boolean): Piece[] {
  const atoms: { index: number; length: number; node: Node }[] = [];
  for (const m of text.matchAll(EMOJI_TOKEN_PATTERN)) {
    atoms.push({
      index: m.index,
      length: m[0].length,
      node: proseSchema.nodes.emoji.create({ animated: m[1] === "a", name: m[2], id: m[3] }),
    });
  }
  if (mentions) {
    for (const m of text.matchAll(MENTION_PATTERN)) {
      const lead = m[1] ?? "";
      atoms.push({
        index: m.index + lead.length,
        length: m[2]!.length + 1,
        node: proseSchema.nodes.mention.create({ handle: m[2]!.toLowerCase() }),
      });
    }
  }
  atoms.sort((a, b) => a.index - b.index);

  const pieces: Piece[] = [];
  let last = 0;
  for (const atom of atoms) {
    if (atom.index < last) continue;
    if (atom.index > last) pieces.push(text.slice(last, atom.index));
    pieces.push(atom.node);
    last = atom.index + atom.length;
  }
  if (last < text.length) pieces.push(text.slice(last));
  return pieces;
}

/** Stored text → editor document. Tokens inside code stay text. */
export function parseProse(value: string, { mentions = false } = {}): Node {
  const lines: Node[][] = [[]];
  const push = (piece: Piece) => {
    if (typeof piece !== "string") {
      lines.at(-1)!.push(piece);
      return;
    }
    piece.split("\n").forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines.at(-1)!.push(proseSchema.text(part));
    });
  };
  value.split(CODE_PATTERN).forEach((segment, i) => {
    if (i % 2 === 1) push(segment);
    else for (const piece of inlinePieces(segment, mentions)) push(piece);
  });
  return proseSchema.nodes.doc.create(
    null,
    lines.map((line) => proseSchema.nodes.paragraph.create(null, line)),
  );
}

function inlineSource(node: Node): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === "emoji") {
    return emojiToken({
      id: node.attrs.id as string,
      name: node.attrs.name as string,
      animated: node.attrs.animated as boolean,
    });
  }
  if (node.type.name === "mention") return `@${node.attrs.handle as string}`;
  return "";
}

/** Editor content → stored text. */
export function serializeProse(content: Fragment): string {
  const lines: string[] = [];
  content.forEach((block) => {
    if (block.isTextblock) {
      let line = "";
      block.forEach((inline) => (line += inlineSource(inline)));
      lines.push(line);
    } else {
      lines.push(inlineSource(block));
    }
  });
  return lines.join("\n");
}

/** Pasted plain text, parsed the same way stored text is. */
export function proseSliceFromText(text: string, options: { mentions?: boolean }): Slice {
  const doc = parseProse(text.replace(/\r\n?/g, "\n"), options);
  return new Slice(doc.content, 1, 1);
}

/** The trigger being typed, with its document position. */
export type ActiveTrigger = TriggerMatch & { from: number; to: number };

export function activeTrigger(state: EditorState): ActiveTrigger | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  // Atoms read as a space, so an emoji right before `:` still counts as a boundary.
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, " ");
  const match = findTrigger(before, before.length);
  if (!match) return null;
  return { ...match, from: $from.start() + match.start, to: $from.pos };
}

/** Backspace or delete next to a chip removes the whole chip. */
export const deleteAtom =
  (dir: -1 | 1): Command =>
  (state, dispatch) => {
    const { selection } = state;
    if (!selection.empty) return false;
    const node = dir < 0 ? selection.$from.nodeBefore : selection.$from.nodeAfter;
    if (!node || !node.isAtom || node.isText) return false;
    const pos = selection.from;
    dispatch?.(state.tr.delete(dir < 0 ? pos - node.nodeSize : pos, dir < 0 ? pos : pos + 1));
    return true;
  };
