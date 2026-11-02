import { EditorState, type Extension, Prec, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  MatchDecorator,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type RefObject, useId, useMemo, useRef, useState } from "react";

import {
  type Suggestion,
  type SuggestionTrigger,
  SuggestionList,
  suggestionText,
  useTextSuggestions,
} from "@/components/ui/text-suggestions";
import { guildEmojiElement } from "@/components/ui/typography/emoji";
import { EMOJI_TOKEN_PATTERN, type GuildEmoji } from "@/lib/discord-emoji";
import { findTrigger } from "@/lib/textarea-autocomplete";
import { unicodeEmojiFor } from "@/lib/unicode-emoji";

/** Past `max` characters, further input is refused. */
export const capLength = (max: number) =>
  EditorState.changeFilter.of(
    (tr) => tr.newDoc.length <= max || tr.newDoc.length <= tr.startState.doc.length,
  );

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

const emojiDecoration = (emoji: GuildEmoji) =>
  Decoration.replace({ widget: new EmojiWidget(emoji) });

/** Draws a matcher's ranges; `atomic` makes the caret step over each one whole. */
export function decorated(
  build: (view: EditorView) => DecorationSet,
  update: (update: ViewUpdate, current: DecorationSet) => DecorationSet,
  atomic: boolean,
): Extension {
  const plugin = ViewPlugin.define(
    (view) => ({
      decorations: build(view),
      update(u: ViewUpdate) {
        this.decorations = update(u, this.decorations);
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

export function matched(decorator: MatchDecorator, atomic: boolean): Extension {
  return decorated(
    (view) => decorator.createDeco(view),
    (u, current) => decorator.updateDeco(u, current),
    atomic,
  );
}

/** Stored `<:name:id>` tokens drawn as the emoji. */
export const guildEmojiTokens = matched(
  new MatchDecorator({
    regexp: new RegExp(EMOJI_TOKEN_PATTERN.source, "g"),
    decoration: (match) =>
      emojiDecoration({ animated: match[1] === "a", name: match[2]!, id: match[3]! }),
  }),
  true,
);

/** Dispatch when the guild's emoji list arrives, so `:name:` text already typed gets drawn. */
export const emojisChanged = StateEffect.define<null>();

/**
 * `:name:` text for the guild's own emojis drawn as the emoji, for fields
 * whose value stays plain text. Names the list doesn't have stay as typed.
 */
export function guildShortcodes(emojis: () => GuildEmoji[]): Extension {
  const decorator = new MatchDecorator({
    regexp: /:([\w+-]{2,32}):/g,
    decorate: (add, from, to, match) => {
      const emoji = emojis().find((e) => e.name === match[1]);
      if (emoji) add(from, to, emojiDecoration(emoji));
    },
  });
  return decorated(
    (view) => decorator.createDeco(view),
    (u, current) =>
      u.transactions.some((tr) => tr.effects.some((e) => e.is(emojisChanged)))
        ? decorator.createDeco(u.view)
        : decorator.updateDeco(u, current),
    true,
  );
}

type EditorTrigger = SuggestionTrigger & { to: number };

function triggerAt(state: EditorState): EditorTrigger | null {
  const { main } = state.selection;
  if (!main.empty) return null;
  const line = state.doc.lineAt(main.head);
  const match = findTrigger(line.text.slice(0, main.head - line.from), main.head - line.from);
  return match ? { ...match, from: line.from + match.start, to: main.head } : null;
}

const FINISHED_SHORTCODE = /(^|[\s([{]):([\w+-]{2,32})$/;

/**
 * Completions for a CodeMirror editor: the list, the keys that drive it
 * (ahead of the editor's own while it's open), and a typed-out `:name:`
 * turning into its emoji. `guildEmoji` is how a guild emoji is written into
 * the text; standard ones go in as the character.
 */
export function useEditorSuggestions(
  view: RefObject<EditorView | null>,
  { mentions = false, guildEmoji }: { mentions?: boolean; guildEmoji: (e: GuildEmoji) => string },
) {
  const listId = useId();
  const [trigger, setTrigger] = useState<EditorTrigger | null>(null);
  const { live, suggestions, active, emojis, unicodeEmojis, setActive, move, dismiss } =
    useTextSuggestions(trigger, { mentions });

  const pick = (s: Suggestion) => {
    const v = view.current;
    if (!v || !live) return;
    const spaced = /^\s/.test(v.state.sliceDoc(live.to, live.to + 1));
    const insert =
      (s.kind === "emoji" ? guildEmoji(s.emoji) : suggestionText(s)) + (spaced ? "" : " ");
    v.dispatch({
      changes: { from: live.from, to: live.to, insert },
      selection: { anchor: live.from + insert.length },
      userEvent: "input.complete",
    });
    v.focus();
  };

  // The editor is built once; its handlers read the current render here.
  const latest = useRef({ suggestions, active, move, dismiss, pick, emojis, unicodeEmojis });
  latest.current = { suggestions, active, move, dismiss, pick, emojis, unicodeEmojis };
  const format = useRef(guildEmoji);
  format.current = guildEmoji;

  const [extensions] = useState<Extension>(() => {
    const whileOpen = (run: () => void) => () => {
      if (latest.current.suggestions.length === 0) return false;
      run();
      return true;
    };
    const pickActive = () => {
      const { suggestions, active, pick } = latest.current;
      pick(suggestions[active] ?? suggestions[0]!);
    };
    return [
      Prec.highest(
        keymap.of([
          { key: "ArrowDown", run: whileOpen(() => latest.current.move(1)) },
          { key: "ArrowUp", run: whileOpen(() => latest.current.move(-1)) },
          { key: "Enter", run: whileOpen(pickActive) },
          { key: "Tab", run: whileOpen(pickActive) },
          { key: "Escape", run: whileOpen(() => latest.current.dismiss()) },
        ]),
      ),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.selectionSet || u.focusChanged) {
          setTrigger(u.view.hasFocus ? triggerAt(u.state) : null);
        }
      }),
      EditorView.inputHandler.of((v, from, to, text) => {
        if (text !== ":") return false;
        const line = v.state.doc.lineAt(from);
        const before = line.text.slice(0, from - line.from);
        if ((before.split("`").length - 1) % 2 === 1) return false;
        const match = FINISHED_SHORTCODE.exec(before);
        if (!match) return false;
        const found = latest.current.emojis.find((e) => e.name === match[2]);
        const insert = found
          ? format.current(found)
          : unicodeEmojiFor(latest.current.unicodeEmojis, match[2]!);
        if (!insert) return false;
        const start = line.from + match.index + match[1]!.length;
        v.dispatch({
          changes: { from: start, to, insert },
          selection: { anchor: start + insert.length },
          userEvent: "input.type",
        });
        return true;
      }),
    ];
  });

  const anchor = useMemo(
    () => ({
      get contextElement() {
        return view.current?.dom;
      },
      getBoundingClientRect: () => {
        const at = live ? view.current?.coordsAtPos(live.from) : null;
        return at ? new DOMRect(at.left, at.top, 1, at.bottom - at.top) : new DOMRect();
      },
    }),
    // Re-anchor only when a new trigger starts, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live?.from],
  );

  const list = (
    <SuggestionList
      id={listId}
      anchor={anchor}
      suggestions={suggestions}
      active={active}
      onActive={setActive}
      onPick={pick}
      onDismiss={dismiss}
    />
  );

  return { extensions, list, emojis };
}
