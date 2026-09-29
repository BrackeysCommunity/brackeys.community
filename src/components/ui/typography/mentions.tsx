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

const DOT_CLASS = "inline-block size-1 animate-pulse rounded-full bg-current align-middle";
const DOT_DELAYS = ["0ms", "150ms", "300ms"];

/** The sigil and three pulsing dots, a chip's content while its name loads. */
export function MentionLoading({ sigil = "@" }: { sigil?: string }) {
  return (
    <span role="status" aria-label="Loading mention">
      {sigil}
      <span className="inline-flex gap-0.5 px-0.5">
        {DOT_DELAYS.map((delay) => (
          <span key={delay} className={DOT_CLASS} style={{ animationDelay: delay }} />
        ))}
      </span>
    </span>
  );
}

/** The same loading content, for the editor's plain-DOM chips. */
export function mentionLoadingDom(sigil = "@"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.append(sigil);
  const dots = document.createElement("span");
  dots.className = "inline-flex gap-0.5 px-0.5";
  for (const delay of DOT_DELAYS) {
    const dot = document.createElement("span");
    dot.className = DOT_CLASS;
    dot.style.animationDelay = delay;
    dots.append(dot);
  }
  wrap.append(dots);
  return wrap;
}

/** `@name` with the avatar-card tooltip; a profile link when there's a handle. */
export function MentionChip({
  handle,
  name,
  avatarUrl,
  isPending,
  known = true,
}: {
  handle: string | null;
  name: string;
  avatarUrl: string | null;
  isPending: boolean;
  /** Off when nobody was found, so the tooltip doesn't restate the fallback. */
  known?: boolean;
}) {
  const content = isPending ? <MentionLoading /> : `@${name}`;
  return (
    <SimpleTooltip
      delay={250}
      content={
        known && !isPending ? (
          <span className="flex items-center gap-2">
            <UserAvatar avatarUrl={avatarUrl} username={name} size={24} />
            <span className="flex flex-col gap-0.5 leading-none">
              <span className="font-medium">{name}</span>
              {handle ? <span className="opacity-70">@{handle}</span> : null}
            </span>
          </span>
        ) : (
          `@${name}`
        )
      }
    >
      {handle ? (
        <Link
          to="/profile/$userId"
          params={{ userId: handle.toLowerCase() }}
          className={cn(
            MENTION_BADGE_CLASS,
            // beats `MarkedText`'s link color and underline
            "text-primary! no-underline! hover:bg-primary hover:text-primary-foreground!",
          )}
        >
          {content}
        </Link>
      ) : (
        <span className={MENTION_BADGE_CLASS}>{content}</span>
      )}
    </SimpleTooltip>
  );
}

/** `@Display Name`, linking to the profile; the bare handle when nobody owns it. */
function MentionBadge({ handle }: { handle: string }) {
  const { data, isPending } = useMentionName(handle);
  return (
    <MentionChip
      handle={handle}
      name={data?.displayName ?? handle}
      avatarUrl={data?.avatarUrl ?? null}
      isPending={isPending}
      known={!!data}
    />
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
