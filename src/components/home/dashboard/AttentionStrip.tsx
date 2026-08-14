import { useMutation } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { teamLinkParams } from "@/lib/team-links";
import { client } from "@/orpc/client";

import { pendingInvites, postsAwaitingTriage } from "./dashboard-derive";
import type { HomeDashboardData } from "./use-home-dashboard";

interface AttentionStripProps {
  invites: HomeDashboardData["invites"];
  posts: HomeDashboardData["posts"];
  onInviteResponded: () => void;
}

/**
 * The reason the dashboard exists: the two things that are waiting on the
 * viewer personally and that nothing else in the app will clear for them —
 * an unanswered team invite, and applicants nobody has triaged.
 *
 * Both were previously reachable only by remembering to go and look: an
 * invite through the team page or a notification that scrolls away, an
 * applicant through opening each of your own posts in turn.
 */
export function AttentionStrip({ invites, posts, onInviteResponded }: AttentionStripProps) {
  const waiting = pendingInvites(invites);
  const triage = postsAwaitingTriage(posts);
  if (waiting.length === 0 && triage.length === 0) return null;

  return (
    <Section title="NEEDS YOU" blurb="Answers only you can give.">
      <Well className="overflow-hidden">
        <ul className="divide-y divide-muted/20">
          {waiting.map((invite) => (
            <li key={`invite-${invite.id}`}>
              <InviteRow invite={invite} onResponded={onInviteResponded} />
            </li>
          ))}
          {triage.map((post) => (
            <li key={`post-${post.id}`}>
              <RouterLink
                to="/collab/$postId"
                params={{ postId: String(post.id) }}
                className="group flex items-center gap-3 px-3 py-2.5 text-inherit transition-colors hover:bg-muted/40"
              >
                <Badge variant="warning" size="label" className="shrink-0">
                  {post.pendingResponseCount} NEW
                </Badge>
                <Text
                  as="div"
                  bold
                  ellipsis
                  size="md"
                  className="min-w-0 flex-1 group-hover:text-primary"
                >
                  {post.title}
                </Text>
                <MicroLabel as="div" className="shrink-0">
                  REVIEW
                </MicroLabel>
              </RouterLink>
            </li>
          ))}
        </ul>
      </Well>
    </Section>
  );
}

/**
 * Accept and decline inline — the same `respondToInvite` call the team page's
 * invite bar makes, on the same no-confirmation terms, so the two surfaces
 * don't disagree about how heavy the decision is.
 */
function InviteRow({
  invite,
  onResponded,
}: {
  invite: HomeDashboardData["invites"][number];
  onResponded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const respond = useMutation({
    mutationFn: (accept: boolean) => client.respondToInvite({ inviteId: invite.id, accept }),
    onSuccess: () => {
      setError(null);
      onResponded();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Could not answer the invite."),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <UserAvatar avatarUrl={invite.team.avatarUrl} username={invite.team.name} size={28} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Text as="div" size="md" ellipsis>
          <RouterLink
            to="/teams/$teamId"
            params={teamLinkParams(invite.team)}
            className="font-bold text-inherit hover:text-primary"
          >
            {invite.team.name}
          </RouterLink>{" "}
          <Text as="span" size="sm" variant="muted">
            invited you
          </Text>
        </Text>
        <MicroLabel as="div" ellipsis>
          {invite.message ? `“${invite.message}”` : `FROM ${invite.inviter.displayName}`}
        </MicroLabel>
        {error ? (
          <Text size="xs" className="text-destructive">
            {error}
          </Text>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="xs"
          className="tracking-widest"
          disabled={respond.isPending}
          onClick={() => respond.mutate(true)}
        >
          ACCEPT
        </Button>
        <Button
          size="xs"
          variant="outline"
          className="tracking-widest"
          disabled={respond.isPending}
          onClick={() => respond.mutate(false)}
        >
          DECLINE
        </Button>
      </div>
    </div>
  );
}
