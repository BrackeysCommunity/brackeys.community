import "prosemirror-view/style/prosemirror.css";
import { useQuery } from "@tanstack/react-query";
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { InputRule, inputRules } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Node } from "prosemirror-model";
import { EditorState, Plugin, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import * as React from "react";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { TEXTAREA_CLASS } from "@/components/ui/textarea";
import { GUILD_EMOJI_CLASS, GuildEmojiImage } from "@/components/ui/typography/emoji";
import { MENTION_BADGE_CLASS } from "@/components/ui/typography/mentions";
import { UserAvatar } from "@/components/ui/user-avatar";
import { type GuildEmoji, emojiUrl, filterEmojis } from "@/lib/discord-emoji";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useGuildEmojis } from "@/lib/hooks/use-guild-emojis";
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
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

type Suggestion =
  | { kind: "emoji"; key: string; emoji: GuildEmoji }
  | { kind: "mention"; key: string; handle: string; name: string; avatarUrl: string | null };

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

function insertAtom(view: EditorView, trigger: ActiveTrigger, node: Node) {
  const after = view.state.doc.resolve(trigger.to).nodeAfter;
  const spaced = after?.isText === true && /^\s/.test(after.text ?? "");
  const tr = view.state.tr.replaceWith(trigger.from, trigger.to, node);
  const end = trigger.from + node.nodeSize;
  if (!spaced) tr.insertText(" ", end);
  tr.setSelection(TextSelection.create(tr.doc, end + 1));
  view.dispatch(tr);
  view.focus();
}

/** Mentions parsed from stored text only know their handle; fetch the names. */
function labelMentions(view: EditorView) {
  const handles = new Set<string>();
  view.state.doc.descendants((node) => {
    if (node.type.name === "mention" && !node.attrs.label) handles.add(node.attrs.handle as string);
  });
  for (const handle of handles) {
    void loadMentionName(handle).then((found) => {
      if (!found || view.isDestroyed) return;
      const tr = view.state.tr;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "mention" && node.attrs.handle === handle && !node.attrs.label) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: found.displayName });
        }
      });
      if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
    });
  }
}

/**
 * A plain-text field for member-written prose, with guild emojis and
 * `@mentions` as inline chips. Typing `:` and two letters offers emojis,
 * `@` offers members (with `mentions`), and a typed-out `:name:` becomes
 * its emoji. The value is the markdown source the app stores:
 * `<:name:id>` for emojis and `@handle` for mentions.
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
  const [dismissedAt, setDismissedAt] = React.useState<number | null>(null);
  const [highlight, setHighlight] = React.useState({ key: "", index: 0 });

  const { data: emojis = [] } = useGuildEmojis();
  const open = trigger && trigger.from !== dismissedAt ? trigger : null;
  const live = open && (open.kind === "emoji" || mentions) ? open : null;
  const mentionQuery = useDebouncedValue(live?.kind === "mention" ? live.query : "", 200);
  const { data: people } = useQuery({
    ...orpc.searchProfiles.queryOptions({ input: { search: mentionQuery } }),
    enabled: mentions && mentionQuery.length >= 2,
    staleTime: STALE.listing,
  });

  const suggestions = React.useMemo<Suggestion[]>(() => {
    if (!live) return [];
    if (live.kind === "emoji") {
      return filterEmojis(emojis, live.query).map((emoji) => ({
        kind: "emoji",
        key: emoji.id,
        emoji,
      }));
    }
    return (people ?? [])
      .filter((p) => p.urlStub)
      .slice(0, 6)
      .map((p) => ({
        kind: "mention",
        key: p.id,
        handle: p.urlStub!,
        name: p.displayName,
        avatarUrl: p.avatarUrl,
      }));
  }, [live, emojis, people]);

  const triggerKey = live ? `${live.kind}:${live.from}:${live.query}` : "";
  const active = highlight.key === triggerKey ? highlight.index : 0;

  const pick = (s: Suggestion) => {
    const view = viewRef.current;
    if (!view || !live) return;
    const node =
      s.kind === "emoji"
        ? proseSchema.nodes.emoji.create(s.emoji)
        : proseSchema.nodes.mention.create({ handle: s.handle.toLowerCase(), label: s.name });
    insertAtom(view, live, node);
  };

  // The editor lives outside React; these refs let its handlers read the
  // current render without rebuilding the view.
  const latest = React.useRef({ suggestions, active, live, triggerKey, pick, emojis, mentions });
  latest.current = { suggestions, active, live, triggerKey, pick, emojis, mentions };
  const callbacks = React.useRef({ onValueChange, onBlur, disabled, maxLength });
  callbacks.current = { onValueChange, onBlur, disabled, maxLength };

  const plugins = React.useMemo<Plugin[]>(
    () => [
      history(),
      inputRules({
        rules: [
          // A finished `:name:` for a known emoji turns into the emoji.
          new InputRule(/(^|[\s([{]):(\w{2,32}):$/, (state, match, start, end) => {
            const before = state.doc
              .resolve(start)
              .parent.textBetween(0, state.doc.resolve(start).parentOffset);
            if ((before.split("`").length - 1) % 2 === 1) return null;
            const emoji = latest.current.emojis.find((e) => e.name === match[2]);
            if (!emoji) return null;
            const from = start + match[1]!.length;
            return state.tr.replaceWith(from, end, proseSchema.nodes.emoji.create(emoji));
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
        emoji: (node) => {
          const img = document.createElement("img");
          img.src = emojiUrl({
            id: node.attrs.id as string,
            animated: node.attrs.animated as boolean,
          });
          img.alt = `:${node.attrs.name as string}:`;
          img.draggable = false;
          img.className = GUILD_EMOJI_CLASS;
          return { dom: img };
        },
        mention: (node) => {
          const chip = document.createElement("span");
          chip.className = cn(MENTION_BADGE_CLASS, "pointer-events-none");
          chip.textContent = `@${(node.attrs.label as string | null) ?? (node.attrs.handle as string)}`;
          return { dom: chip };
        },
      },
      handleKeyDown: (_view, event) => {
        const { suggestions, active, live, triggerKey, pick } = latest.current;
        if (!live || suggestions.length === 0 || event.isComposing) return false;
        const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const step = event.key === "ArrowDown" ? 1 : -1;
          setHighlight({
            key: triggerKey,
            index: (active + step + suggestions.length) % suggestions.length,
          });
          return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && plain) {
          pick(suggestions[active] ?? suggestions[0]!);
          return true;
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          setDismissedAt(live.from);
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
        // A dismissal lasts until the word it closed on is gone.
        if (!current) setDismissedAt(null);
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
  }, [value, mentions, plugins]);

  React.useEffect(() => {
    viewRef.current?.setProps({ editable: () => !disabled });
  }, [disabled]);

  const anchor = React.useMemo(
    () => ({
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
      <Popover
        open={showList}
        onOpenChange={(next) => {
          if (!next && live) setDismissedAt(live.from);
        }}
      >
        <PopoverContent
          anchor={anchor}
          side="bottom"
          align="start"
          initialFocus={false}
          finalFocus={false}
          className="w-60 gap-0 p-1"
        >
          <div id={listId} role="listbox" className="flex flex-col">
            {suggestions.map((s, i) => (
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keys drive it from the editor
              <div
                key={s.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                data-highlighted={i === active ? "" : undefined}
                // pointerdown, so the editor keeps focus and its selection
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setHighlight({ key: triggerKey, index: i })}
                onClick={() => pick(s)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              >
                {s.kind === "emoji" ? (
                  <>
                    <GuildEmojiImage emoji={s.emoji} className="h-5! align-middle" />
                    <span className="truncate">:{s.emoji.name}:</span>
                  </>
                ) : (
                  <>
                    <UserAvatar avatarUrl={s.avatarUrl} username={s.name} size={18} />
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto truncate opacity-60">@{s.handle}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
