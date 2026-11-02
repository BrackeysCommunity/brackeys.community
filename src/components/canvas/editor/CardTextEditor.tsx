import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder,
} from "@codemirror/view";
import { use, useEffect, useEffectEvent, useRef } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import {
  capLength,
  guildEmojiTokens,
  matched,
  useEditorSuggestions,
} from "@/components/ui/editor-suggestions";
import { MENTION_BADGE_CLASS } from "@/components/ui/typography/mentions";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { emojiToken } from "@/lib/discord-emoji";
import { MENTION_PATTERN } from "@/lib/forum-mentions";

import { PresenceContext } from "./presence-store";

/**
 * Text undo history per card, kept after the editor closes: `yCollab` would
 * otherwise start a fresh one on every open, and ⌘Z would forget what you
 * typed a minute ago.
 */
const undoManagers = new WeakMap<Y.Text, Y.UndoManager>();

function undoManagerFor(text: Y.Text): Y.UndoManager {
  let manager = undoManagers.get(text);
  if (!manager) {
    manager = new Y.UndoManager(text);
    undoManagers.set(text, manager);
  }
  return manager;
}

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "0.875rem", backgroundColor: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6", padding: "0.75rem" },
  ".cm-content": { padding: 0, caretColor: "var(--foreground)" },
  ".cm-line": { padding: 0 },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent) !important",
  },
  // Peers' name labels stay up (not only on hover) and use the site's face.
  "& .cm-ySelectionInfo": {
    opacity: 1,
    fontFamily: "inherit",
    fontWeight: 500,
    borderRadius: "3px",
    padding: "0 3px",
  },
});

const normalizeLineBreaks = (text: string) => text.replace(/\r\n?/g, "\n");

const mentionMark = Decoration.mark({ class: MENTION_BADGE_CLASS });

/** Guild emojis drawn as themselves (the caret steps over them whole), mentions as chips. */
const chips = [
  guildEmojiTokens,
  matched(
    new MatchDecorator({
      regexp: new RegExp(MENTION_PATTERN.source, "gi"),
      decorate: (add, from, to, match) => add(from + match[1]!.length, to, mentionMark),
    }),
    false,
  ),
];

/**
 * CodeMirror on one card's `Y.Text`. Only one is ever mounted: every other
 * card renders its text statically and re-renders when it changes. On a
 * live canvas it shows the other editors' carets and selections in this
 * card, with their names.
 */
export function CardTextEditor({
  text,
  onDone,
  maxLength = CANVAS_LIMITS.maxCardText,
}: {
  text: Y.Text;
  onDone: () => void;
  /** Characters; a note body on a file card takes a whole note's worth. */
  maxLength?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const finish = useEffectEvent(() => onDone());
  const awareness = use(PresenceContext)?.awareness ?? null;
  const suggest = useEditorSuggestions(viewRef, { mentions: true, guildEmoji: emojiToken });

  useEffect(() => {
    if (!host.current) return;
    // Tearing the editor down blurs it; that blur isn't the member leaving.
    let tearingDown = false;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text.toJSON(),
        extensions: [
          // Ahead of everything while the completion list is open.
          suggest.extensions,
          // First, so ⌘Z reaches this card's own text history.
          keymap.of(yUndoManagerKeymap),
          keymap.of([
            {
              key: "Escape",
              run: () => {
                finish();
                return true;
              },
            },
            ...defaultKeymap,
          ]),
          drawSelection(),
          EditorView.lineWrapping,
          markdown(),
          placeholder("Write something…"),
          capLength(maxLength),
          // Y.Text counts `\r\n` as two characters; CodeMirror's default
          // separator would count it as one and shift every edit after it.
          EditorState.lineSeparator.of("\n"),
          // With that separator a pasted or dropped `\r` would stay in the
          // card; a body imported with CRLF keeps its own.
          EditorView.clipboardInputFilter.of(normalizeLineBreaks),
          theme,
          chips,
          yCollab(text, awareness, { undoManager: undoManagerFor(text) }),
          EditorView.domEventHandlers({
            blur: () => {
              if (!tearingDown) finish();
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return () => {
      tearingDown = true;
      viewRef.current = null;
      view.destroy();
      // yCollab leaves the caret behind; peers would keep drawing it.
      if (awareness?.getLocalState()) awareness.setLocalStateField("cursor", null);
    };
    // `suggest.extensions` is built once and never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, maxLength, awareness]);

  return (
    <>
      <div ref={host} className="nodrag nowheel nopan nokey h-full cursor-text" />
      {suggest.list}
    </>
  );
}
