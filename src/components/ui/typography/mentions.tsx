import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { SimpleTooltip } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MENTION_PATTERN } from "@/lib/forum-mentions";
import { useMentionName } from "@/lib/mention-names";
import { cn } from "@/lib/utils";

/**
 * The mention chip, shared by rendered text and the editor's DOM: an inline
 * run of the surrounding text on a soft fill, so it sits on the baseline
 * and keeps the line's size.
 */
export const MENTION_BADGE_CLASS =
  "inline rounded-[4px] bg-primary/20 px-0.5 font-medium text-primary transition-colors";

/** `@Display Name`, linking to the profile; the handle until the name loads. */
function MentionBadge({ handle }: { handle: string }) {
  const { data } = useMentionName(handle);
  return (
    <SimpleTooltip
      delay={250}
      content={
        data ? (
          <span className="flex items-center gap-2">
            <UserAvatar avatarUrl={data.avatarUrl} username={data.displayName} size={24} />
            <span className="flex flex-col gap-0.5 leading-none">
              <span className="font-medium">{data.displayName}</span>
              <span className="opacity-70">@{data.handle}</span>
            </span>
          </span>
        ) : (
          `@${handle}`
        )
      }
    >
      <Link
        to="/profile/$userId"
        params={{ userId: handle.toLowerCase() }}
        className={cn(
          MENTION_BADGE_CLASS,
          // beats `MarkedText`'s link color and underline
          "text-primary! no-underline! hover:bg-primary hover:text-primary-foreground!",
        )}
      >
        @{data?.displayName ?? handle}
      </Link>
    </SimpleTooltip>
  );
}

/**
 * Splits `text` around `@handle` mentions: each handle becomes a chip
 * linking to that profile, everything between goes through `rest`. A
 * handle nobody owns still links, and the profile page says so.
 */
export function withMentionLinks(text: string, rest: (text: string) => ReactNode): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const lead = match[1] ?? "";
    const handle = match[2]!;
    const start = match.index + lead.length;
    if (start > last) parts.push(rest(text.slice(last, start)));
    parts.push(<MentionBadge handle={handle} />);
    last = start + handle.length + 1;
  }
  if (parts.length === 0) return rest(text);
  if (last < text.length) parts.push(rest(text.slice(last)));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}
