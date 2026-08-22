import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useState } from "react";

import { inviteAttentionKey, triageAttentionKey } from "@/components/attention/attention-items";
import {
  dismissAttentionItem,
  restoreDismissedAttention,
} from "@/components/attention/dismissed-attention";
import type { AttentionData } from "@/components/attention/use-attention";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { Censored } from "@/lib/hooks/use-censored";
import { reportMutationError } from "@/lib/posthog";
import { teamLinkParams } from "@/lib/team-links";
import { client } from "@/orpc/client";

/**
 * The reason the dashboard exists: the two things waiting on the viewer
 * personally that nothing else in the app will clear for them — an unanswered
 * team invite, and applicants nobody has triaged.
 *
 * Both were previously reachable only by remembering to go and look: an
 * invite through the team page or a notification that scrolls away, an
 * applicant through opening each of your own posts in turn.
 */
export function AttentionStrip({ attention }: { attention: AttentionData }) {
  const { visibleInvites, visibleTriage, hiddenCount } = attention;
  if (visibleInvites.length === 0 && visibleTriage.length === 0 && hiddenCount === 0) return null;

  return (
    <Section id="attention" title="NEEDS YOU" blurb="Answers only you can give.">
      <Well className="overflow-hidden">
        <ul className="divide-y divide-muted/20">
          {visibleInvites.map((invite) => (
            <li key={`invite-${invite.id}`}>
              <InviteRow invite={invite} onResponded={attention.invalidateInvites} />
            </li>
          ))}
          {visibleTriage.map((post) => (
            <li key={`post-${post.id}`} className="group flex items-center">
              <RouterLink
                to="/collab/$postId"
                params={{ postId: String(post.id) }}
                className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-inherit transition-colors hover:bg-muted/40"
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
              <DismissButton
                label={`Hide ${post.title} until someone else applies`}
                onDismiss={() => dismissAttentionItem(triageAttentionKey(post))}
              />
            </li>
          ))}
        </ul>

        {/* A dismissal must be visibly reversible. Without this line the strip
            is a place where things quietly disappear, which is the one thing
            an "only you can clear this" list must never be. */}
        {hiddenCount > 0 ? (
          <div className="flex items-center justify-between gap-2 border-t border-muted/20 px-3 py-2">
            <MicroLabel>
              {hiddenCount} HIDDEN{" "}
              {visibleInvites.length === 0 && visibleTriage.length === 0
                ? "· NOTHING ELSE OPEN"
                : ""}
            </MicroLabel>
            <button
              type="button"
              onClick={restoreDismissedAttention}
              className="transition-colors hover:text-primary"
            >
              <MicroLabel>SHOW</MicroLabel>
            </button>
          </div>
        ) : null}
      </Well>
    </Section>
  );
}

/**
 * Hiding a row, not resolving it: the count in the header drops with it, and
 * a triage row comes back on its own the moment another applicant lands (its
 * dismissal key carries the count). Invites have no such trigger, so theirs
 * is only undone through SHOW.
 */
function DismissButton({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onDismiss}
      className="mr-2 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
    >
      <HugeiconsIcon icon={Cancel01Icon} size={12} />
    </button>
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
  invite: AttentionData["visibleInvites"][number];
  onResponded: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const respond = useMutation({
    mutationFn: (accept: boolean) => client.respondToInvite({ inviteId: invite.id, accept }),
    onSuccess: () => {
      setError(null);
      onResponded();
    },
    onError: (err) => {
      reportMutationError(err, "team.invite_respond");
      setError(errorMessage(err, "Could not answer the invite."));
    },
  });

  return (
    <div className="group flex flex-wrap items-center gap-3 px-3 py-2.5">
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
          {invite.message ? (
            <>
              “<Censored>{invite.message}</Censored>”
            </>
          ) : (
            `FROM ${invite.inviter.displayName}`
          )}
        </MicroLabel>
        {error ? (
          <Text size="xs" className="text-destructive">
            {error}
          </Text>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
        <DismissButton
          label={`Hide the invite from ${invite.team.name}`}
          onDismiss={() => dismissAttentionItem(inviteAttentionKey(invite))}
        />
      </div>
    </div>
  );
}
