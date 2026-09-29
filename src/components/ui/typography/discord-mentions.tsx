import { Fragment, type ReactNode } from "react";

import { MENTION_BADGE_CLASS, MentionChip } from "@/components/ui/typography/mentions";
import { DISCORD_MENTION_PATTERN, roleColor } from "@/lib/discord-mentions";
import { useGuildRoles } from "@/lib/hooks/use-guild-channels";
import { useDiscordUserName } from "@/lib/mention-names";

/** A `<@id>`: their profile when they have one, their guild name otherwise. */
function DiscordUserBadge({ discordId, link }: { discordId: string; link: boolean }) {
  const { data, isPending } = useDiscordUserName(discordId);
  return (
    <MentionChip
      handle={link ? (data?.handle ?? null) : null}
      name={data?.displayName ?? "unknown-user"}
      avatarUrl={data?.avatarUrl ?? null}
      isPending={isPending}
      known={!!data}
    />
  );
}

/** A `<@&id>` in the role's own color, the way Discord draws it. */
function RoleBadge({ roleId }: { roleId: string }) {
  const { data } = useGuildRoles();
  const role = data?.find((r) => r.id === roleId);
  const color = role ? roleColor(role.color) : null;
  return (
    <span
      className={MENTION_BADGE_CLASS}
      style={
        color
          ? { color, backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)` }
          : undefined
      }
    >
      @{role?.name ?? "unknown-role"}
    </span>
  );
}

/**
 * Splits `text` around Discord `<@id>` and `<@&id>` tokens; everything
 * between goes through `rest`. `link` off keeps chips plain inside a button.
 */
export function withDiscordMentions(
  text: string,
  rest: (text: string) => ReactNode,
  { link = true } = {},
): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(DISCORD_MENTION_PATTERN)) {
    if (match.index > last) parts.push(rest(text.slice(last, match.index)));
    parts.push(
      match[1] === "&" ? (
        <RoleBadge roleId={match[2]!} />
      ) : (
        <DiscordUserBadge discordId={match[2]!} link={link} />
      ),
    );
    last = match.index + match[0].length;
  }
  if (parts.length === 0) return rest(text);
  if (last < text.length) parts.push(rest(text.slice(last)));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}
