import { LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { client, orpc } from "@/orpc/client";

interface ResponseItem {
  id: number;
  responderId: string;
  message: string;
  portfolioUrl: string | null;
  status: string;
  createdAt: string | Date | null;
  responderUsername: string | null;
  responderAvatar: string | null;
  /** This applicant's skills against the post's stack. Null when the
   *  post didn't declare one. */
  stackOverlap: { matched: string[]; missing: string[]; total: number } | null;
}

interface CollabPostResponseListProps {
  responses: ResponseItem[];
  postId: number;
  /** The named team behind the post, when there is one — unlocks the
   *  accept → "invite to the team" handoff on accepted rows. */
  team?: { id: string; name: string } | null;
}

const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning"> = {
  accepted: "success",
  declined: "destructive",
  pending: "warning",
};

/**
 * Owner-only list of responses to a post — each row is a `Well`
 * (debossed) carrying the responder's avatar + handle, message, and
 * optional accept/decline actions for pending entries.
 */
export function CollabPostResponseList({ responses, postId, team }: CollabPostResponseListProps) {
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: ({ responseId, status }: { responseId: number; status: "accepted" | "declined" }) =>
      client.updateResponseStatus({ responseId, status }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      }),
  });

  // Accepting is a decision to work together; joining the team page is
  // the destination that makes it real. One click, but explicit — teams
  // may accept-to-talk before committing a roster spot.
  const [invitedIds, setInvitedIds] = useState<Set<number>>(new Set());
  const [inviteError, setInviteError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: (resp: ResponseItem) =>
      client.inviteToTeam({
        teamId: team!.id,
        inviteeId: resp.responderId,
        sourceResponseId: resp.id,
      }),
    onSuccess: (_data, resp) => {
      setInvitedIds((prev) => new Set(prev).add(resp.id));
      setInviteError(null);
    },
    onError: (err) =>
      setInviteError(err instanceof Error ? err.message : "Could not send the invite."),
  });

  return (
    <div className="flex flex-col gap-2">
      {responses.map((resp) => (
        <Well key={resp.id} className="gap-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <UserAvatar
                avatarUrl={resp.responderAvatar}
                username={resp.responderUsername}
                size={24}
              />
              <Text size="xs" className="truncate">
                {resp.responderUsername
                  ? `@${resp.responderUsername}`
                  : resp.responderId.slice(0, 8)}
              </Text>
            </div>
            <Badge
              variant={STATUS_VARIANT[resp.status] ?? "outline"}
              size="label"
              className="uppercase"
            >
              {resp.status}
            </Badge>
          </div>
          <StackOverlapLine overlap={resp.stackOverlap} />
          <Text size="sm" className="whitespace-pre-wrap text-foreground/90">
            {resp.message}
          </Text>
          {resp.portfolioUrl ? (
            <a
              href={resp.portfolioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <HugeiconsIcon icon={LinkSquare01Icon} size={11} />
              Portfolio
            </a>
          ) : null}
          {resp.status === "pending" ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="xs"
                onClick={() => updateStatus.mutate({ responseId: resp.id, status: "accepted" })}
                disabled={updateStatus.isPending}
                className="tracking-widest"
              >
                ACCEPT
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => updateStatus.mutate({ responseId: resp.id, status: "declined" })}
                disabled={updateStatus.isPending}
                className="tracking-widest"
              >
                DECLINE
              </Button>
            </div>
          ) : null}
          {resp.status === "accepted" && team ? (
            invitedIds.has(resp.id) ? (
              <Text size="xs" variant="success" className="tracking-widest uppercase">
                Invited to {team.name}
              </Text>
            ) : (
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => invite.mutate(resp)}
                  disabled={invite.isPending}
                  className="self-start tracking-widest"
                >
                  INVITE TO {team.name.toUpperCase()}
                </Button>
                {inviteError && invite.variables?.id === resp.id ? (
                  <Text size="xs" className="text-destructive">
                    {inviteError}
                  </Text>
                ) : null}
              </div>
            )
          ) : null}
        </Well>
      ))}
    </div>
  );
}

/**
 * The applicant's profile skills measured against the post's declared
 * stack. Turns triage from reading every paragraph into scanning chips —
 * which is the whole reason a post's stack and a person's skills draw
 * from one vocabulary instead of two.
 */
function StackOverlapLine({ overlap }: { overlap: ResponseItem["stackOverlap"] }) {
  if (!overlap || overlap.total === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Text as="span" size="xs" variant="muted" className="tracking-widest uppercase">
        {overlap.matched.length}/{overlap.total} stack
      </Text>
      {overlap.matched.map((name) => (
        <Badge
          key={name}
          variant="outline"
          size="label"
          className="border-success/50 text-success uppercase"
        >
          {name}
        </Badge>
      ))}
      {overlap.missing.map((name) => (
        <Badge
          key={name}
          variant="outline"
          size="label"
          className="text-muted-foreground uppercase opacity-60"
        >
          {name}
        </Badge>
      ))}
    </div>
  );
}
