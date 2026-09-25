import { Fragment, type ReactNode, useState } from "react";

import { TransformedImage } from "@/components/ui/transformed-image";
import { useCensorNodes } from "@/components/ui/typography/censored";
import { withMentionLinks } from "@/components/ui/typography/mentions";
import { EMOJI_TOKEN_PATTERN, type GuildEmoji, emojiUrl } from "@/lib/discord-emoji";
import type { ItchImageOpts } from "@/lib/itch-image";
import { cn } from "@/lib/utils";

/** Inline at text size; the `!`s beat prose image rules like `MarkedText`'s. */
export const GUILD_EMOJI_CLASS =
  "my-0! inline-block h-[1.375em]! w-auto max-w-none! rounded-none! object-contain align-[-0.3em]";

/** Small flat art: a low quality setting smears the edges. */
export const GUILD_EMOJI_TRANSFORM: ItchImageOpts = { quality: 90 };

/**
 * One guild emoji, sized to the surrounding text. An emoji deleted from
 * the guild 404s on the CDN, and then it reads as its `:name:`.
 */
export function GuildEmojiImage({ emoji, className }: { emoji: GuildEmoji; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <>:{emoji.name}:</>;
  const src = emojiUrl(emoji);
  return (
    <TransformedImage
      data-slot="guild-emoji"
      src={src}
      transform={GUILD_EMOJI_TRANSFORM}
      alt={`:${emoji.name}:`}
      decoding="async"
      draggable={false}
      // A server-rendered image can fail before hydration attaches onError.
      // Only the plain source failing counts; a refused transform is retried.
      ref={(node) => {
        if (node?.src === src && node.complete && node.naturalWidth === 0) setBroken(true);
      }}
      onError={() => setBroken(true)}
      className={cn(GUILD_EMOJI_CLASS, className)}
    />
  );
}

/** Splits `text` around `<:name:id>` tokens; everything between goes through `rest`. */
export function withEmojis(text: string, rest: (text: string) => ReactNode): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(EMOJI_TOKEN_PATTERN)) {
    if (match.index > last) parts.push(rest(text.slice(last, match.index)));
    parts.push(
      <GuildEmojiImage emoji={{ animated: match[1] === "a", name: match[2]!, id: match[3]! }} />,
    );
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return rest(text);
  if (last < text.length) parts.push(rest(text.slice(last)));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

const MAX_JUMBO_EMOJIS = 27;

/** A body that is nothing but emojis renders them large, the way Discord does. */
export function isEmojiOnly(text: string): boolean {
  const tokens = text.match(EMOJI_TOKEN_PATTERN);
  if (!tokens || tokens.length > MAX_JUMBO_EMOJIS) return false;
  return text.replace(EMOJI_TOKEN_PATTERN, "").trim() === "";
}

export const JUMBO_EMOJI_CLASS = "[&_[data-slot=guild-emoji]]:h-12!";

/** Plain member text with emojis drawn, optionally mentions linked, and the rest censored. */
export function EmojiText({
  children,
  mentions,
}: {
  children: string | null | undefined;
  mentions?: boolean;
}) {
  const censor = useCensorNodes();
  if (!children) return null;
  const rest = mentions ? (text: string) => withMentionLinks(text, censor) : censor;
  const content = withEmojis(children, rest);
  return isEmojiOnly(children) ? <span className={JUMBO_EMOJI_CLASS}>{content}</span> : content;
}
