import { useStore, ViewportPortal } from "@xyflow/react";
import { memo, use, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  type Suggestion,
  type SuggestionTrigger,
  SuggestionList,
  useTextSuggestions,
} from "@/components/ui/text-suggestions";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { withEmojiShortcodes } from "@/components/ui/typography/emoji";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MAX_CHAT, type PresenceUser } from "@/lib/canvas/presence";
import { useGuildEmojis } from "@/lib/hooks/use-guild-emojis";
import { findTrigger } from "@/lib/textarea-autocomplete";
import { unicodeEmojiFor } from "@/lib/unicode-emoji";
import { cn } from "@/lib/utils";

import {
  PresenceContext,
  type PresenceStore,
  useCardMarks,
  usePeerPointers,
  usePeople,
  useSelfChat,
} from "./presence-store";

const NAME_TAG = "rounded-md px-1.5 py-0.5 text-[11px] leading-tight font-medium text-white";

/** Peers' pointers with name tags, in flow coordinates, kept at screen size. */
export function PeerCursors() {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <ViewportPortal>
      <PeerCursorMarks zoom={zoom} />
    </ViewportPortal>
  );
}

/** The cursors themselves, for any layer already in flow coordinates. */
export function PeerCursorMarks({ zoom }: { zoom: number }) {
  const pointers = usePeerPointers();
  if (pointers.length === 0) return null;
  return pointers.map((p) => (
    <div
      key={p.clientId}
      aria-hidden
      data-peer-cursor={p.user.id}
      className="pointer-events-none absolute top-0 left-0 z-[1000] transition-transform duration-75 ease-linear"
      style={{
        transform: `translate(${p.x}px, ${p.y}px) scale(${1 / zoom})`,
        transformOrigin: "0 0",
      }}
    >
      <svg width="16" height="18" viewBox="0 0 16 18" className="drop-shadow-sm">
        <path
          d="M1 1l13 7.5-5.8 1.4L5.6 16z"
          fill={p.user.color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {p.chat ? (
        <ChatBubble color={p.user.color} name={p.user.name}>
          <ChatText text={p.chat} />
        </ChatBubble>
      ) : (
        <span
          className={`${NAME_TAG} absolute top-4 left-3 whitespace-nowrap shadow-sm`}
          style={{ backgroundColor: p.user.color }}
        >
          {p.user.name}
        </span>
      )}
    </div>
  ));
}

/**
 * A card's outline in each selecting peer's color, with their names on it,
 * and "<name> is typing" while one of them has its text open. Its own
 * subscription, so the card around it never re-renders for presence.
 */
export const PeerCardMarks = memo(function PeerCardMarks({ id }: { id: string }) {
  const { selectedBy, typing } = useCardMarks(id);
  if (selectedBy.length === 0 && !typing) return null;
  const lead = typing ?? selectedBy[0]!;
  const names = selectedBy.filter((u) => u.id !== typing?.id).map((u) => u.name);
  return (
    <div aria-hidden className="pointer-events-none absolute -inset-1 z-10">
      <div className="absolute inset-0 rounded-xl border-2" style={{ borderColor: lead.color }} />
      <div className="absolute bottom-full left-0 mb-0.5 flex max-w-full items-center gap-1">
        {typing ? <TypingTag user={typing} /> : null}
        {names.length ? (
          <span className={`${NAME_TAG} truncate`} style={{ backgroundColor: lead.color }}>
            {names.join(", ")}
          </span>
        ) : null}
      </div>
    </div>
  );
});

function TypingTag({ user }: { user: PresenceUser }) {
  return (
    <span
      className={`${NAME_TAG} flex shrink-0 items-center gap-1 pl-0.5`}
      style={{ backgroundColor: user.color }}
    >
      <UserAvatar avatarUrl={user.avatarUrl} username={user.name} size={14} />
      {user.name} is typing
    </span>
  );
}

const MAX_FACES = 4;

/**
 * Everyone here, this tab's own face first, for the top-right island.
 * Clicking someone else goes to them; idle people are grayed out.
 */
export function PresenceAvatars({ onLocate }: { onLocate: (userId: string) => void }) {
  const self = use(PresenceContext)?.self;
  const everyone = usePeople();
  if (!self) return null;
  const people = everyone.filter((p) => p.id !== self.id);
  const shown = people.slice(0, MAX_FACES - 1);
  const more = people.length - shown.length;
  return (
    <>
      <div role="group" aria-label="People here" className="flex items-center -space-x-1.5 pr-1">
        <SimpleTooltip content={`${self.name} (you)`}>
          <span
            role="img"
            aria-label={`${self.name} (you)`}
            className="flex size-7 items-center justify-center"
          >
            <span className="rounded-full" style={{ boxShadow: `0 0 0 2px ${self.color}` }}>
              <UserAvatar avatarUrl={self.avatarUrl} username={self.name} size={24} />
            </span>
          </span>
        </SimpleTooltip>
        {shown.map((person) => (
          <Button
            key={person.id}
            variant="ghost"
            size="icon-sm"
            tooltip={
              person.locatable
                ? `${person.name}: go to them`
                : `${person.name}${person.idle ? " · idle" : ""}`
            }
            aria-label={person.locatable ? `Go to ${person.name}` : person.name}
            aria-disabled={!person.locatable || undefined}
            data-idle={person.idle || undefined}
            // Square and unfilled: the cursor's frame probes its corners, and a
            // round button's corners land on the overlapping neighbour.
            className="rounded-none hover:z-10 hover:bg-transparent aria-disabled:cursor-default dark:hover:bg-transparent"
            onClick={() => {
              if (person.locatable) onLocate(person.id);
            }}
          >
            <span
              className={cn(
                "rounded-full transition-[filter,opacity]",
                person.idle && "opacity-50 grayscale",
              )}
              style={{ boxShadow: `0 0 0 2px ${person.color}` }}
            >
              <UserAvatar avatarUrl={person.avatarUrl} username={person.name} size={24} />
            </span>
          </Button>
        ))}
        {more > 0 ? <span className="pl-2.5 text-xs text-muted-foreground">+{more}</span> : null}
      </div>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
    </>
  );
}

function ChatBubble({
  color,
  name,
  children,
}: {
  color: string;
  name?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-4 left-3 flex w-max max-w-60 flex-col rounded-2xl rounded-tl-sm px-2.5 py-1.5 text-sm leading-snug text-white shadow-md"
      style={{ backgroundColor: color }}
    >
      {name ? <span className="text-[11px] font-medium opacity-80">{name}</span> : null}
      <span className="break-words whitespace-pre-wrap">{children}</span>
    </div>
  );
}

/** Chat holds plain text, so guild emojis travel as `:name:` and are drawn here. */
function ChatText({ text }: { text: string }) {
  const { data: emojis = [] } = useGuildEmojis();
  return withEmojiShortcodes(text, emojis);
}

type ChatTrigger = SuggestionTrigger & { to: number };

const FINISHED_SHORTCODE = /(^|[\s([{]):([\w+-]{2,32}):$/;

/**
 * The chat field: `:` offers emojis (inserted as the character, or as
 * `:name:` for the guild's own), and a typed-out standard `:name:` becomes
 * its character. Enter sends, Escape drops it, unless the list is open.
 */
function ChatInput({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (text: string) => void;
  onClose: (send: boolean) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const caretAfter = useRef<number | null>(null);
  const listId = useId();
  const [caret, setCaret] = useState(value.length);
  const found = findTrigger(value, caret);
  const trigger: ChatTrigger | null =
    found?.kind === "emoji" ? { ...found, from: found.start, to: caret } : null;
  const { live, suggestions, active, unicodeEmojis, setActive, move, dismiss } =
    useTextSuggestions(trigger);

  const attachInput = useCallback((el: HTMLInputElement | null) => {
    input.current = el;
    el?.focus();
  }, []);
  // Browser UI (a find bar, another window) can take focus mid-message;
  // the field stays open and picks focus back up when the page regains it.
  useEffect(() => {
    const refocus = () => input.current?.focus();
    window.addEventListener("focus", refocus);
    return () => window.removeEventListener("focus", refocus);
  }, []);
  useLayoutEffect(() => {
    if (caretAfter.current == null || !input.current) return;
    input.current.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  });

  const replace = (from: number, to: number, insert: string) => {
    const next = (value.slice(0, from) + insert + value.slice(to)).slice(0, MAX_CHAT);
    const at = Math.min(from + insert.length, next.length);
    caretAfter.current = at;
    setCaret(at);
    onChange(next);
  };

  const pick = (s: Suggestion) => {
    if (!live) return;
    if (s.kind === "emoji") replace(live.from, live.to, `:${s.emoji.name}: `);
    else if (s.kind === "unicode") replace(live.from, live.to, `${s.emoji} `);
  };

  const anchor = {
    get contextElement() {
      return input.current ?? undefined;
    },
    getBoundingClientRect: () => input.current?.getBoundingClientRect() ?? new DOMRect(),
  };

  return (
    <>
      <input
        ref={attachInput}
        aria-label="Chat at your cursor"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={suggestions.length > 0 ? listId : undefined}
        aria-activedescendant={suggestions.length > 0 ? `${listId}-${active}` : undefined}
        placeholder="Say something"
        maxLength={MAX_CHAT}
        value={value}
        onChange={(e) => {
          const at = e.target.selectionStart ?? e.target.value.length;
          const before = e.target.value.slice(0, at);
          const finished = before.endsWith(":") ? FINISHED_SHORTCODE.exec(before) : null;
          const standard = finished && unicodeEmojiFor(unicodeEmojis, finished[2]!);
          if (finished && standard) {
            const from = finished.index + finished[1]!.length;
            const next = e.target.value.slice(0, from) + standard + e.target.value.slice(at);
            caretAfter.current = from + standard.length;
            setCaret(from + standard.length);
            onChange(next);
            return;
          }
          setCaret(at);
          onChange(e.target.value);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? value.length)}
        onKeyDown={(e) => {
          if (suggestions.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") move(e.key === "ArrowDown" ? 1 : -1);
            else if (e.key === "Enter" || e.key === "Tab") pick(suggestions[active]!);
            else if (e.key === "Escape") dismiss();
            else return;
          } else if (e.key === "Enter") onClose(true);
          else if (e.key === "Escape") onClose(false);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onBlur={() => {
          if (document.hasFocus()) onClose(true);
        }}
        className="nodrag nopan pointer-events-auto w-52 bg-transparent text-white outline-none placeholder:text-white/70"
      />
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

/**
 * This tab's chat bubble at its own pointer: a field while open, then the
 * sent message until it lingers out. Peers see it live as it's typed.
 */
export function SelfChatBubble({ store }: { store: PresenceStore }) {
  const chat = useSelfChat();
  const zoom = useStore((s) => s.transform[2]);
  if (!chat.at || (!chat.open && !chat.text)) return null;
  return (
    <ViewportPortal>
      <div
        className="absolute top-0 left-0 z-[1001]"
        style={{
          transform: `translate(${chat.at.x}px, ${chat.at.y}px) scale(${1 / zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <ChatBubble color={store.self.color}>
          {chat.open ? (
            <ChatInput
              value={chat.text}
              onChange={(text) => store.typeChat(text)}
              onClose={(send) => store.closeChat(send)}
            />
          ) : (
            <ChatText text={chat.text} />
          )}
        </ChatBubble>
      </div>
    </ViewportPortal>
  );
}
