import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  MatchDecorator,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { use, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from "react";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import {
  type Suggestion,
  type SuggestionTrigger,
  SuggestionList,
  suggestionText,
  useTextSuggestions,
} from "@/components/ui/text-suggestions";
import { guildEmojiElement } from "@/components/ui/typography/emoji";
import { MENTION_BADGE_CLASS } from "@/components/ui/typography/mentions";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";
import { EMOJI_TOKEN_PATTERN, type GuildEmoji, emojiToken } from "@/lib/discord-emoji";
import { MENTION_PATTERN } from "@/lib/forum-mentions";
import { findTrigger } from "@/lib/textarea-autocomplete";
import { type UnicodeEmoji, unicodeEmojiFor } from "@/lib/unicode-emoji";

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

/** Past the card's character cap, further input is refused. */
const capLength = (max: number) =>
  EditorState.changeFilter.of(
    (tr) => tr.newDoc.length <= max || tr.newDoc.length <= tr.startState.doc.length,
  );

const normalizeLineBreaks = (text: string) => text.replace(/\r\n?/g, "\n");

class EmojiWidget extends WidgetType {
  constructor(readonly emoji: GuildEmoji) {
    super();
  }
  eq(other: EmojiWidget) {
    return other.emoji.id === this.emoji.id;
  }
  toDOM() {
    return guildEmojiElement(this.emoji);
  }
}

const emojiTokens = new MatchDecorator({
  regexp: new RegExp(EMOJI_TOKEN_PATTERN.source, "g"),
  decoration: (match) =>
    Decoration.replace({
      widget: new EmojiWidget({ animated: match[1] === "a", name: match[2]!, id: match[3]! }),
    }),
});

const mentionMark = Decoration.mark({ class: MENTION_BADGE_CLASS });
const mentions = new MatchDecorator({
  regexp: new RegExp(MENTION_PATTERN.source, "gi"),
  decorate: (add, from, to, match) => add(from + match[1]!.length, to, mentionMark),
});

function decorated(decorator: MatchDecorator, atomic: boolean) {
  const plugin = ViewPlugin.define(
    (view) => ({
      decorations: decorator.createDeco(view),
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations);
      },
    }),
    { decorations: (v) => v.decorations },
  );
  return atomic
    ? [
        plugin,
        EditorView.atomicRanges.of(
          (view) => (view.plugin(plugin)?.decorations as DecorationSet) ?? Decoration.none,
        ),
      ]
    : plugin;
}

/** Guild emojis drawn as themselves (the caret steps over them whole), mentions as chips. */
const chips = [decorated(emojiTokens, true), decorated(mentions, false)];

type CardTrigger = SuggestionTrigger & { to: number };

function triggerAt(state: EditorState): CardTrigger | null {
  const { main } = state.selection;
  if (!main.empty) return null;
  const line = state.doc.lineAt(main.head);
  const match = findTrigger(line.text.slice(0, main.head - line.from), main.head - line.from);
  return match ? { ...match, from: line.from + match.start, to: main.head } : null;
}

const FINISHED_SHORTCODE = /(^|[\s([{]):([\w+-]{2,32})$/;

/** A typed-out `:name:` for a known emoji becomes the emoji. */
function shortcodeEmoji(emojis: () => { guild: GuildEmoji[]; standard: UnicodeEmoji[] }) {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (text !== ":") return false;
    const line = view.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from);
    if ((before.split("`").length - 1) % 2 === 1) return false;
    const match = FINISHED_SHORTCODE.exec(before);
    if (!match) return false;
    const { guild, standard } = emojis();
    const found = guild.find((e) => e.name === match[2]);
    const insert = found ? emojiToken(found) : unicodeEmojiFor(standard, match[2]!);
    if (!insert) return false;
    const start = line.from + match.index + match[1]!.length;
    view.dispatch({
      changes: { from: start, to, insert },
      selection: { anchor: start + insert.length },
      userEvent: "input.type",
    });
    return true;
  });
}

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
  const listId = useId();
  const [trigger, setTrigger] = useState<CardTrigger | null>(null);
  const { live, suggestions, active, emojis, unicodeEmojis, setActive, move, dismiss } =
    useTextSuggestions(trigger, { mentions: true });

  const pick = (s: Suggestion) => {
    const view = viewRef.current;
    if (!view || !live) return;
    const spaced = /^\s/.test(view.state.sliceDoc(live.to, live.to + 1));
    const insert = suggestionText(s) + (spaced ? "" : " ");
    view.dispatch({
      changes: { from: live.from, to: live.to, insert },
      selection: { anchor: live.from + insert.length },
      userEvent: "input.complete",
    });
    view.focus();
  };

  // The editor is built once per card; its handlers read the current render here.
  const latest = useRef({ suggestions, active, move, dismiss, pick, emojis, unicodeEmojis });
  latest.current = { suggestions, active, move, dismiss, pick, emojis, unicodeEmojis };

  const listKeys = Prec.highest(
    keymap.of(
      (
        [
          ["ArrowDown", () => latest.current.move(1)],
          ["ArrowUp", () => latest.current.move(-1)],
          ["Enter", () => pickActive()],
          ["Tab", () => pickActive()],
          ["Escape", () => latest.current.dismiss()],
        ] as const
      ).map(([key, run]) => ({
        key,
        run: () => {
          if (latest.current.suggestions.length === 0) return false;
          run();
          return true;
        },
      })),
    ),
  );
  function pickActive() {
    const { suggestions, active, pick } = latest.current;
    pick(suggestions[active] ?? suggestions[0]!);
  }

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
          listKeys,
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
          shortcodeEmoji(() => ({
            guild: latest.current.emojis,
            standard: latest.current.unicodeEmojis,
          })),
          EditorView.updateListener.of((update) => {
            if (update.docChanged || update.selectionSet || update.focusChanged) {
              setTrigger(update.view.hasFocus ? triggerAt(update.state) : null);
            }
          }),
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
    // The key handlers read through `latest`, so they don't rebuild the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, maxLength, awareness]);

  const anchor = useMemo(
    () => ({
      get contextElement() {
        return viewRef.current?.dom;
      },
      getBoundingClientRect: () => {
        const at = live ? viewRef.current?.coordsAtPos(live.from) : null;
        return at ? new DOMRect(at.left, at.top, 1, at.bottom - at.top) : new DOMRect();
      },
    }),
    // Re-anchor only when a new trigger starts, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live?.from],
  );

  return (
    <>
      <div ref={host} className="nodrag nowheel nopan nokey h-full cursor-text" />
      <SuggestionList
        id={listId}
        anchor={anchor}
        suggestions={suggestions}
        active={active}
        onActive={setActive}
        onPick={pick}
        onDismiss={dismiss}
      />
    </>
  );
}
