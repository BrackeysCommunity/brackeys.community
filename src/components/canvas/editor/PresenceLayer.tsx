import { useStore, ViewportPortal } from "@xyflow/react";
import { memo } from "react";

import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MAX_CHAT, type PresenceUser } from "@/lib/canvas/presence";
import { cn } from "@/lib/utils";

import {
  type PresenceStore,
  useCardMarks,
  usePeerPointers,
  usePeople,
  useSelfChat,
} from "./presence-store";

const NAME_TAG = "rounded-md px-1.5 py-0.5 text-[11px] leading-tight font-medium text-white";

/** Peers' pointers with name tags, in flow coordinates, kept at screen size. */
export function PeerCursors() {
  const pointers = usePeerPointers();
  const zoom = useStore((s) => s.transform[2]);
  if (pointers.length === 0) return null;
  return (
    <ViewportPortal>
      {pointers.map((p) => (
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
              {p.chat}
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
      ))}
    </ViewportPortal>
  );
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

/** Everyone else here, for the top-right island. Clicking one goes to them; idle people are grayed out. */
export function PresenceAvatars({ onLocate }: { onLocate: (userId: string) => void }) {
  const people = usePeople();
  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_FACES);
  const more = people.length - shown.length;
  return (
    <>
      <div role="group" aria-label="People here" className="flex items-center -space-x-1.5 pr-1">
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
            className="rounded-full hover:z-10 aria-disabled:cursor-default"
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

const focusOnMount = (input: HTMLInputElement | null) => input?.focus();

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
            <input
              ref={focusOnMount}
              aria-label="Chat at your cursor"
              placeholder="Say something"
              maxLength={MAX_CHAT}
              value={chat.text}
              onChange={(e) => store.typeChat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") store.closeChat(true);
                else if (e.key === "Escape") store.closeChat(false);
                else return;
                e.preventDefault();
                e.stopPropagation();
              }}
              onBlur={() => store.closeChat(true)}
              className="nodrag nopan pointer-events-auto w-52 bg-transparent text-white outline-none placeholder:text-white/70"
            />
          ) : (
            chat.text
          )}
        </ChatBubble>
      </div>
    </ViewportPortal>
  );
}
