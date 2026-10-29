import "prosemirror-view/style/prosemirror.css";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Node } from "prosemirror-model";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import * as React from "react";

import {
  type Suggestion,
  SuggestionList,
  useTextSuggestions,
} from "@/components/ui/text-suggestions";
import { TEXTAREA_CLASS } from "@/components/ui/textarea";
import { guildEmojiElement } from "@/components/ui/typography/emoji";
import { MENTION_BADGE_CLASS, mentionLoadingDom } from "@/components/ui/typography/mentions";
import type { GuildChannel } from "@/lib/discord-channels";
import { useGuildChannels } from "@/lib/hooks/use-guild-channels";
import { loadMentionName } from "@/lib/mention-names";
import {
  type ActiveTrigger,
  activeTrigger,
  deleteAtom,
  parseProse,
  proseSchema,
  proseSliceFromText,
  serializeProse,
} from "@/lib/prose-doc";
import { unicodeEmojiFor } from "@/lib/unicode-emoji";
import { cn } from "@/lib/utils";

type ProseEditorProps = {
  value: string;
  onValueChange: (value: string) => void;
  /** Offer `@handle` completions and show mentions as chips. Needs a signed-in viewer. */
  mentions?: boolean;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
};

/** Replaces the typed trigger with an atom or plain text, then a space. */
function insertAtom(view: EditorView, trigger: ActiveTrigger, node: Node | string) {
  const after = view.state.doc.resolve(trigger.to).nodeAfter;
  const spaced = after?.isText === true && /^\s/.test(after.text ?? "");
  const tr =
    typeof node === "string"
      ? view.state.tr.insertText(node, trigger.from, trigger.to)
      : view.state.tr.replaceWith(trigger.from, trigger.to, node);
  const end = trigger.from + (typeof node === "string" ? node.length : node.nodeSize);
  if (!spaced) tr.insertText(" ", end);
  tr.setSelection(TextSelection.create(tr.doc, end + 1));
  view.dispatch(tr);
  view.focus();
}

/** Mentions parsed from stored text only know their handle; fetch the names, falling back to the handle. */
function labelMentions(view: EditorView) {
  const handles = new Set<string>();
  view.state.doc.descendants((node) => {
    if (node.type.name === "mention" && !node.attrs.label) handles.add(node.attrs.handle as string);
  });
  for (const handle of handles) {
    void loadMentionName(handle).then((found) => {
      if (view.isDestroyed) return;
      const tr = view.state.tr;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "mention" && node.attrs.handle === handle && !node.attrs.label) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: found?.displayName ?? handle });
        }
      });
      if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
    });
  }
}

/** Channels parsed from stored text only know their id; name them once the list is in. */
function labelChannels(view: EditorView, channels: GuildChannel[]) {
  const names = new Map(channels.map((c) => [c.id, c.name]));
  const tr = view.state.tr;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "channel" || node.attrs.label) return;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      label: names.get(node.attrs.id as string) ?? "unknown",
    });
  });
  if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
}

/**
 * A plain-text field for member-written prose, with guild emojis,
 * `@mentions` and `#channels` as inline chips. Typing `:` and two letters
 * offers the guild's emojis, then standard ones (inserted as the character
 * itself), `@` offers members (with `mentions`), `#` offers the server's
 * public channels, and a typed-out `:name:` becomes its emoji. The value
 * is the markdown source the app stores: `<:name:id>` for emojis,
 * `@handle` for mentions and `<#id>` for channels.
 */
export function ProseEditor({
  value,
  onValueChange,
  mentions = false,
  placeholder,
  maxLength,
  rows = 3,
  autoFocus,
  disabled = false,
  className,
  id,
  onBlur,
  onKeyDown,
}: ProseEditorProps) {
  const mountRef = React.useRef<HTMLDivElement | null>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const lastValue = React.useRef(value);
  const listId = React.useId();
  const [trigger, setTrigger] = React.useState<ActiveTrigger | null>(null);

  const { data: guildChannels } = useGuildChannels();
  const pickable = React.useMemo(
    () => guildChannels?.channels.filter((c) => c.kind === "text") ?? [],
    [guildChannels],
  );
  const { live, suggestions, active, emojis, unicodeEmojis, setActive, move, dismiss } =
    useTextSuggestions(trigger, { mentions, channels: pickable });

  const pick = (s: Suggestion) => {
    const view = viewRef.current;
    if (!view || !live) return;
    const node =
      s.kind === "emoji"
        ? proseSchema.nodes.emoji.create(s.emoji)
        : s.kind === "unicode"
          ? s.emoji
          : s.kind === "channel"
            ? proseSchema.nodes.channel.create({ id: s.channel.id, label: s.channel.name })
            : proseSchema.nodes.mention.create({ handle: s.handle.toLowerCase(), label: s.name });
    insertAtom(view, live, node);
  };

  // The editor lives outside React; these refs let its handlers read the
  // current render without rebuilding the view.
  const latest = React.useRef({
    suggestions,
    live,
    active,
    move,
    dismiss,
    pick,
    emojis,
    unicodeEmojis,
    mentions,
  });
  latest.current = {
    suggestions,
    live,
    active,
    move,
    dismiss,
    pick,
    emojis,
    unicodeEmojis,
    mentions,
  };
  const queryChannels = React.useRef(guildChannels);
  queryChannels.current = guildChannels;
  const callbacks = React.useRef({ onValueChange, onBlur, disabled, maxLength });
  callbacks.current = { onValueChange, onBlur, disabled, maxLength };

  const plugins = React.useMemo<Plugin[]>(
    () => [
      history(),
      inputRules({
        rules: [
          // A finished `:name:` for a known emoji turns into the emoji.
          new InputRule(/(^|[\s([{]):([\w+-]{2,32}):$/, (state, match, start, end) => {
            const before = state.doc
              .resolve(start)
              .parent.textBetween(0, state.doc.resolve(start).parentOffset);
            if ((before.split("`").length - 1) % 2 === 1) return null;
            const from = start + match[1]!.length;
            const emoji = latest.current.emojis.find((e) => e.name === match[2]);
            if (emoji)
              return state.tr.replaceWith(from, end, proseSchema.nodes.emoji.create(emoji));
            const standard = unicodeEmojiFor(latest.current.unicodeEmojis, match[2]!);
            return standard ? state.tr.insertText(standard, from, end) : null;
          }),
        ],
      }),
      new Plugin({
        filterTransaction: (tr, state) => {
          const max = callbacks.current.maxLength;
          if (!max || !tr.docChanged) return true;
          const next = serializeProse(tr.doc.content).length;
          return next <= max || next <= serializeProse(state.doc.content).length;
        },
      }),
      keymap({
        Backspace: deleteAtom(-1),
        Delete: deleteAtom(1),
        "Mod-z": undo,
        "Mod-y": redo,
        "Shift-Mod-z": redo,
        "Shift-Enter": baseKeymap.Enter!,
      }),
      keymap(baseKeymap),
    ],
    [],
  );

  React.useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const view = new EditorView(mount, {
      state: EditorState.create({ doc: parseProse(lastValue.current, { mentions }), plugins }),
      editable: () => !callbacks.current.disabled,
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-autocomplete": "list",
        ...(id ? { id } : {}),
      },
      nodeViews: {
        emoji: (node) => ({
          dom: guildEmojiElement({
            id: node.attrs.id as string,
            name: node.attrs.name as string,
            animated: node.attrs.animated as boolean,
          }),
        }),
        mention: (node) => {
          const chip = document.createElement("span");
          chip.className = cn(MENTION_BADGE_CLASS, "pointer-events-none");
          const label = node.attrs.label as string | null;
          if (label) chip.textContent = `@${label}`;
          else chip.append(mentionLoadingDom());
          return { dom: chip };
        },
        channel: (node) => {
          const chip = document.createElement("span");
          chip.className = cn(MENTION_BADGE_CLASS, "pointer-events-none");
          const label = node.attrs.label as string | null;
          if (label) chip.textContent = `#${label}`;
          else chip.append(mentionLoadingDom("#"));
          return { dom: chip };
        },
      },
      handleKeyDown: (_view, event) => {
        const { suggestions, active, live, move, dismiss, pick } = latest.current;
        if (!live || suggestions.length === 0 || event.isComposing) return false;
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          move(event.key === "ArrowDown" ? 1 : -1);
          return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && plain) {
          pick(suggestions[active] ?? suggestions[0]!);
          return true;
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          dismiss();
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        view.dispatch(
          view.state.tr
            .replaceSelection(proseSliceFromText(text, { mentions: latest.current.mentions }))
            .scrollIntoView(),
        );
        labelMentions(view);
        const loaded = queryChannels.current;
        if (loaded) labelChannels(view, loaded.channels);
        return true;
      },
      clipboardTextSerializer: (slice) => serializeProse(slice.content),
      handleDOMEvents: {
        blur: () => {
          setTrigger(null);
          callbacks.current.onBlur?.();
          return false;
        },
      },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        const current = activeTrigger(next);
        setTrigger(view.hasFocus() || tr.docChanged ? current : null);
        if (tr.docChanged) {
          const serialized = serializeProse(next.doc.content);
          lastValue.current = serialized;
          callbacks.current.onValueChange(serialized);
        }
      },
    });
    viewRef.current = view;
    labelMentions(view);
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Built once; props reach it through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugins]);

  // An outside reset, like clearing the box after posting.
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view || value === lastValue.current) return;
    lastValue.current = value;
    view.updateState(EditorState.create({ doc: parseProse(value, { mentions }), plugins }));
    labelMentions(view);
    if (guildChannels) labelChannels(view, guildChannels.channels);
  }, [value, mentions, plugins, guildChannels]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (view && guildChannels) labelChannels(view, guildChannels.channels);
  }, [guildChannels]);

  React.useEffect(() => {
    viewRef.current?.setProps({ editable: () => !disabled });
  }, [disabled]);

  const anchor = React.useMemo(
    () => ({
      // Lets the positioner find the editor's scroll containers, so the list
      // follows the caret when the page scrolls instead of staying put.
      get contextElement() {
        return viewRef.current?.dom;
      },
      getBoundingClientRect: () => {
        const view = viewRef.current;
        if (!view || !live) return new DOMRect();
        const at = view.coordsAtPos(live.from);
        return new DOMRect(at.left, at.top, 1, at.bottom - at.top);
      },
    }),
    // Re-anchor only when a new trigger starts, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live?.from],
  );

  const showList = suggestions.length > 0;
  React.useEffect(() => {
    const dom = viewRef.current?.dom;
    if (!dom) return;
    dom.setAttribute("aria-expanded", String(showList));
    if (showList) {
      dom.setAttribute("aria-controls", listId);
      dom.setAttribute("aria-activedescendant", `${listId}-${active}`);
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
  }, [showList, active, listId]);

  return (
    <div className="relative w-full">
      <div
        ref={mountRef}
        role="group"
        onKeyDown={(e) => {
          if (!e.defaultPrevented) onKeyDown?.(e);
        }}
        className={cn(
          TEXTAREA_CLASS,
          "block cursor-text wrap-break-word whitespace-pre-wrap",
          "[&_.ProseMirror]:min-h-(--prose-min-h) [&_.ProseMirror]:outline-none",
          "[&_.ProseMirror-selectednode]:outline-2 [&_.ProseMirror-selectednode]:outline-primary",
          disabled && "cursor-not-allowed opacity-50",
          className,
        )}
        style={{ "--prose-min-h": `${rows}lh` } as React.CSSProperties}
        data-slot="textarea"
      />
      {!value && placeholder ? (
        <span className="pointer-events-none absolute top-[calc(0.5rem+1px)] left-[calc(0.625rem+1px)] text-xs text-muted-foreground">
          {placeholder}
        </span>
      ) : null}
      <SuggestionList
        id={listId}
        anchor={anchor}
        suggestions={suggestions}
        active={active}
        onActive={setActive}
        onPick={pick}
        onDismiss={dismiss}
      />
    </div>
  );
}
