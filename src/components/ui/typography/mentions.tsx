import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { useCensorNodes } from "@/components/ui/typography/censored";
import { MENTION_PATTERN } from "@/lib/forum-mentions";

/**
 * Splits `text` around `@handle` mentions: each handle becomes a link to
 * that profile (the profile route resolves a stub), everything between goes
 * through `rest`. A handle nobody owns still links — the profile page says
 * so — which keeps rendering free of a lookup per mention.
 */
export function withMentionLinks(text: string, rest: (text: string) => ReactNode): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const lead = match[1] ?? "";
    const handle = match[2]!;
    const start = match.index + lead.length;
    if (start > last) parts.push(rest(text.slice(last, start)));
    parts.push(
      <Link
        to="/profile/$userId"
        params={{ userId: handle.toLowerCase() }}
        className="font-medium text-primary hover:underline"
      >
        @{handle}
      </Link>,
    );
    last = start + handle.length + 1;
  }
  if (parts.length === 0) return rest(text);
  if (last < text.length) parts.push(rest(text.slice(last)));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

/** Plain text with its mentions linked and the rest censored. */
export function MentionText({ children }: { children: string }) {
  const censor = useCensorNodes();
  return <>{withMentionLinks(children, censor)}</>;
}
