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

import { TeamPickerField } from "./CollabCreateFlyout/TeamPickerField";

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
  /** Latest team invite spawned from this response, if any — the INVITE
   *  button renders from this so its state survives reloads. */
  invite: { status: string; teamId: string } | null;
}

interface CollabPostResponseListProps {
  responses: ResponseItem[];
  postId: number;
  /** The named team behind the post, when there is one — unlocks the
   *  accept → "invite to the team" handoff on accepted rows. */
  team?: { id: string; name: string } | null;
  /** A legacy team post with no linked team. Accepting is server-gated
   *  until one is linked, so ACCEPT opens an inline link-or-create flow
   *  instead of firing a doomed request. */
  needsTeamLink?: boolean;
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
export function CollabPostResponseList({
  responses,
  postId,
  team,
  needsTeamLink = false,
}: CollabPostResponseListProps) {
  const queryClient = useQueryClient();
  const invalidatePost = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
    });

  const [statusError, setStatusError] = useState<string | null>(null);
  const updateStatus = useMutation({
    mutationFn: ({ responseId, status }: { responseId: number; status: "accepted" | "declined" }) =>
      client.updateResponseStatus({ responseId, status }),
    onSuccess: () => {
      setStatusError(null);
      void invalidatePost();
    },
    // The server's accept gate (unlinked team post) lands here if the
    // inline flow was somehow skipped — surface it rather than failing
    // silently.
    onError: (err) =>
      setStatusError(err instanceof Error ? err.message : "Could not update the response."),
  });

  // §3.2 accept-time fix for legacy unlinked posts: pick or create the
  // team right here, link it, then finish the accept — one flow, no
  // page hopping.
  const [linkPromptResponseId, setLinkPromptResponseId] = useState<number | null>(null);
  const linkAndAccept = useMutation({
    mutationFn: async ({ teamId, responseId }: { teamId: string; responseId: number }) => {
      await client.linkPostTeam({ postId, teamId });
      await client.updateResponseStatus({ responseId, status: "accepted" });
    },
    onSuccess: () => {
      setLinkPromptResponseId(null);
      setStatusError(null);
      void invalidatePost();
    },
    onError: (err) =>
      setStatusError(err instanceof Error ? err.message : "Could not link the team."),
  });

  // Accepting is a decision to work together; joining the team page is
  // the destination that makes it real. One click, but explicit — teams
  // may accept-to-talk before committing a roster spot.
  const [inviteError, setInviteError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: (resp: ResponseItem) =>
      client.inviteToTeam({
        teamId: team!.id,
        inviteeId: resp.responderId,
        sourceResponseId: resp.id,
      }),
    onSuccess: () => {
      setInviteError(null);
      void invalidatePost();
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
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    needsTeamLink
                      ? setLinkPromptResponseId(resp.id)
                      : updateStatus.mutate({ responseId: resp.id, status: "accepted" })
                  }
                  disabled={updateStatus.isPending || linkAndAccept.isPending}
                  className="tracking-widest"
                >
                  ACCEPT
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => updateStatus.mutate({ responseId: resp.id, status: "declined" })}
                  disabled={updateStatus.isPending || linkAndAccept.isPending}
                  className="tracking-widest"
                >
                  DECLINE
                </Button>
              </div>
              {linkPromptResponseId === resp.id ? (
                <Well variant="ghost" className="gap-2 border-warning/40 p-3">
                  <Text size="xs" variant="muted">
                    Link your team page before accepting — accepted members get invited to it.
                  </Text>
                  <TeamPickerField
                    value={undefined}
                    onChange={(teamId) => {
                      if (teamId) linkAndAccept.mutate({ teamId, responseId: resp.id });
                    }}
                  />
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setLinkPromptResponseId(null)}
                    className="self-start tracking-widest"
                  >
                    CANCEL
                  </Button>
                </Well>
              ) : null}
              {statusError &&
              (linkPromptResponseId === resp.id ||
                updateStatus.variables?.responseId === resp.id) ? (
                <Text size="xs" className="text-destructive">
                  {statusError}
                </Text>
              ) : null}
            </div>
          ) : null}
          {resp.status === "accepted" && team ? (
            resp.invite?.status === "pending" ? (
              <Text size="xs" variant="success" className="tracking-widest uppercase">
                Invited to {team.name}
              </Text>
            ) : resp.invite?.status === "accepted" ? (
              <Text size="xs" variant="success" className="tracking-widest uppercase">
                Joined {team.name}
              </Text>
            ) : (
              <div className="flex flex-col gap-1">
                {resp.invite?.status === "declined" ? (
                  <Text size="xs" variant="muted" className="tracking-widest uppercase">
                    Declined the invite to {team.name}
                  </Text>
                ) : null}
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
