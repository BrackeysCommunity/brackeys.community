import { Fragment, type ReactNode } from "react";

import { MENTION_BADGE_CLASS, MentionLoading } from "@/components/ui/typography/mentions";
import { CHANNEL_TOKEN_PATTERN } from "@/lib/discord-channels";
import { discordChannelLink } from "@/lib/discord-links";
import { useGuildChannels } from "@/lib/hooks/use-guild-channels";
import { cn } from "@/lib/utils";

/**
 * `#channel-name`, opening the channel in the Discord app unless `link` is
 * off (inside a button). A deleted, staff-only or thread id has no name to
 * show and reads `#unknown`.
 */
function ChannelBadge({ channelId, link }: { channelId: string; link: boolean }) {
  const { data, isPending } = useGuildChannels();
  if (isPending) {
    return (
      <span className={MENTION_BADGE_CLASS}>
        <MentionLoading sigil="#" />
      </span>
    );
  }
  const channel = data?.channels.find((c) => c.id === channelId);
  if (!channel || !data) return <span className={MENTION_BADGE_CLASS}>#unknown</span>;
  if (!link) return <span className={MENTION_BADGE_CLASS}>#{channel.name}</span>;
  return (
    <a
      href={discordChannelLink(data.guildId, channel.id)}
      className={cn(
        MENTION_BADGE_CLASS,
        // beats `MarkedText`'s link color and underline
        "text-primary! no-underline! hover:bg-primary hover:text-primary-foreground!",
      )}
    >
      #{channel.name}
    </a>
  );
}

/** Splits `text` around `<#id>` tokens; everything between goes through `rest`. */
export function withChannelLinks(
  text: string,
  rest: (text: string) => ReactNode,
  { link = true } = {},
): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CHANNEL_TOKEN_PATTERN)) {
    if (match.index > last) parts.push(rest(text.slice(last, match.index)));
    parts.push(<ChannelBadge channelId={match[1]!} link={link} />);
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return rest(text);
  if (last < text.length) parts.push(rest(text.slice(last)));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/** Plain text with `<#id>` tokens named but not linked, for one-line summaries. */
export function ChannelText({ children }: { children: string }) {
  return <>{withChannelLinks(children, (text) => text, { link: false })}</>;
}
