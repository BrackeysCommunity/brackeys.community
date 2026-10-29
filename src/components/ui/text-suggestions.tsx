import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { GuildEmojiImage } from "@/components/ui/typography/emoji";
import { UserAvatar } from "@/components/ui/user-avatar";
import type { GuildChannel } from "@/lib/discord-channels";
import { type GuildEmoji, emojiToken, filterByName } from "@/lib/discord-emoji";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useGuildEmojis, useUnicodeEmojis } from "@/lib/hooks/use-guild-emojis";
import type { TriggerKind } from "@/lib/textarea-autocomplete";
import { filterUnicodeEmojis } from "@/lib/unicode-emoji";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

export type Suggestion =
  | { kind: "emoji"; key: string; emoji: GuildEmoji }
  | { kind: "unicode"; key: string; emoji: string; shortcode: string }
  | { kind: "mention"; key: string; handle: string; name: string; avatarUrl: string | null }
  | { kind: "channel"; key: string; channel: GuildChannel };

/** The `:name`, `@handle` or `#channel` being typed, and where it starts. */
export interface SuggestionTrigger {
  kind: TriggerKind;
  query: string;
  from: number;
}

const MAX_SUGGESTIONS = 8;

/** How a pick reads in stored markdown, for editors that hold plain text. */
export function suggestionText(s: Suggestion): string {
  switch (s.kind) {
    case "emoji":
      return emojiToken(s.emoji);
    case "unicode":
      return s.emoji;
    case "mention":
      return `@${s.handle.toLowerCase()}`;
    case "channel":
      return `<#${s.channel.id}>`;
  }
}

/**
 * Completions for the trigger being typed: guild emojis then standard ones
 * for `:`, members for `@` (with `mentions`), and channels for `#` when a
 * channel list is given. Tracks the highlighted row and an Escape that
 * closes the list until the word it closed on is gone.
 */
export function useTextSuggestions<T extends SuggestionTrigger>(
  trigger: T | null,
  { mentions = false, channels }: { mentions?: boolean; channels?: GuildChannel[] } = {},
) {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [highlight, setHighlight] = useState({ key: "", index: 0 });
  if (!trigger && dismissedAt !== null) setDismissedAt(null);

  const open = trigger && trigger.from !== dismissedAt ? trigger : null;
  const allowed =
    open?.kind === "emoji" ||
    (open?.kind === "mention" && mentions) ||
    (open?.kind === "channel" && channels != null);
  const live = allowed ? open : null;

  const { data: emojis = [] } = useGuildEmojis();
  const { data: unicodeEmojis = [] } = useUnicodeEmojis();
  const mentionQuery = useDebouncedValue(live?.kind === "mention" ? live.query : "", 200);
  const { data: people } = useQuery({
    ...orpc.searchProfiles.queryOptions({ input: { search: mentionQuery } }),
    enabled: mentions && mentionQuery.length >= 2,
    staleTime: STALE.listing,
  });

  let suggestions: Suggestion[] = [];
  if (live?.kind === "emoji") {
    // The guild's own emojis first, standard ones fill the rest.
    const guild: Suggestion[] = filterByName(emojis, live.query).map((emoji) => ({
      kind: "emoji",
      key: emoji.id,
      emoji,
    }));
    const standard: Suggestion[] = filterUnicodeEmojis(
      unicodeEmojis,
      live.query,
      MAX_SUGGESTIONS - guild.length,
    ).map((match) => ({ kind: "unicode", key: match.emoji, ...match }));
    suggestions = [...guild, ...standard];
  } else if (live?.kind === "channel") {
    suggestions = filterByName(channels ?? [], live.query, MAX_SUGGESTIONS).map((channel) => ({
      kind: "channel",
      key: channel.id,
      channel,
    }));
  } else if (live?.kind === "mention") {
    suggestions = (people ?? [])
      .filter((p) => p.urlStub)
      .slice(0, 6)
      .map((p) => ({
        kind: "mention",
        key: p.id,
        handle: p.urlStub!,
        name: p.displayName,
        avatarUrl: p.avatarUrl,
      }));
  }

  const key = live ? `${live.kind}:${live.from}:${live.query}` : "";
  const active = highlight.key === key ? highlight.index : 0;

  return {
    live,
    suggestions,
    active,
    /** The guild's emojis and the standard table, for turning a typed `:name:` into its emoji. */
    emojis,
    unicodeEmojis,
    setActive: (index: number) => setHighlight({ key, index }),
    move: (step: 1 | -1) =>
      setHighlight({
        key,
        index: (active + step + suggestions.length) % suggestions.length,
      }),
    dismiss: () => {
      if (live) setDismissedAt(live.from);
    },
  };
}

/** The completion list, anchored at the trigger and driven from the editor's keys. */
export function SuggestionList({
  id,
  anchor,
  suggestions,
  active,
  onActive,
  onPick,
  onDismiss,
}: {
  id: string;
  anchor: { getBoundingClientRect: () => DOMRect; contextElement?: Element };
  suggestions: Suggestion[];
  active: number;
  onActive: (index: number) => void;
  onPick: (s: Suggestion) => void;
  onDismiss: () => void;
}) {
  return (
    <Popover
      open={suggestions.length > 0}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="bottom"
        align="start"
        initialFocus={false}
        finalFocus={false}
        className="w-60 gap-0 p-1 in-data-anchor-hidden:invisible"
      >
        <div id={id} role="listbox" className="flex flex-col">
          {suggestions.map((s, i) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keys drive it from the editor
            <div
              key={s.key}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              data-highlighted={i === active ? "" : undefined}
              // pointerdown, so the editor keeps focus and its selection
              onPointerDown={(e) => e.preventDefault()}
              onPointerEnter={() => onActive(i)}
              onClick={() => onPick(s)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
            >
              {s.kind === "emoji" ? (
                <>
                  <GuildEmojiImage emoji={s.emoji} className="h-5! align-middle" />
                  <span className="truncate">:{s.emoji.name}:</span>
                </>
              ) : s.kind === "unicode" ? (
                <>
                  <span className="w-5 text-center text-base leading-none">{s.emoji}</span>
                  <span className="truncate">:{s.shortcode}:</span>
                </>
              ) : s.kind === "channel" ? (
                <>
                  <span className="w-5 text-center text-base leading-none opacity-60">#</span>
                  <span className="truncate">{s.channel.name}</span>
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
  );
}
