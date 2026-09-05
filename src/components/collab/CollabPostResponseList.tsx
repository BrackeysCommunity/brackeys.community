import { LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DiscordMessageButton } from "@/components/ui/discord-message-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/typography";
import { Censored } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

import { CrewCreateInline } from "./CollabCreateFlyout/CrewCreateInline";
import { TeamPickerField } from "./CollabCreateFlyout/TeamPickerField";
import { ResponseThreadPanel } from "./ResponseThreadPanel";

interface ResponseItem {
  id: number;
  responderId: string;
  message: string;
  portfolioUrl: string | null;
  status: string;
  createdAt: string | Date | null;
  responderUsername: string | null;
  responderAvatar: string | null;
  /** Only used once accepted — the door to the conversation the match earned. */
  responderDiscordId: string | null;
  /** This applicant's skills against the post's stack. Null when the
   *  post didn't declare one. */
  stackOverlap: { matched: string[]; missing: string[]; total: number } | null;
  /** Latest team invite spawned from this response, if any — the INVITE
   *  button renders from this so its state survives reloads. */
  invite: { status: string; teamId: string } | null;
  /** Messages in the private thread on this application — 0 until someone
   *  asks something, since the thread is created lazily. */
  threadCommentCount: number;
}

/** The parts of the post the triage list decides from. */
interface ResponsePost {
  id: number;
  title: string;
  projectName: string | null;
  /** "No crew yet". A solo post may be accepted without one; a team post
   *  without a team may not — accepting is what attaches the crew. */
  isIndividual: boolean | null;
  /** The named team behind the post, when there is one — unlocks the
   *  accept → invite handoff. */
  team: { id: string; name: string } | null;
}

interface CollabPostResponseListProps {
  responses: ResponseItem[];
  post: ResponsePost;
}

type AcceptInput = Parameters<typeof client.acceptAndInvite>[0];

const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning"> = {
  accepted: "success",
  declined: "destructive",
  pending: "warning",
};

/**
 * Owner-only list of responses to a post — each row is a `Well`
 * (debossed) carrying the responder's avatar + handle, message, and the
 * accept/decline actions for pending entries.
 *
 * Accepting is where the crew becomes real: on a post with a team, ACCEPT
 * & INVITE puts the person on its roster in one click; on a post without
 * one, ACCEPT opens the choice to start a crew (named after the post),
 * use an existing team, or — solo posts only — just accept and talk.
 */
export function CollabPostResponseList({ responses, post }: CollabPostResponseListProps) {
  const queryClient = useQueryClient();
  const team = post.team;
  const invalidateResponses = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.listResponses.queryOptions({ input: { postId: post.id } }).queryKey,
    });
  // Attaching or minting a crew changes the post itself — its team tile,
  // the strengthen panel — so the page's `getPost` re-reads too.
  const invalidatePost = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.getPost.queryOptions({ input: { postId: post.id } }).queryKey,
    });

  const [statusError, setStatusError] = useState<string | null>(null);
  const updateStatus = useMutation({
    mutationFn: ({ responseId, status }: { responseId: number; status: "accepted" | "declined" }) =>
      client.updateResponseStatus({ responseId, status }),
    onSuccess: () => {
      setStatusError(null);
      void invalidateResponses();
    },
    onError: (err) => {
      reportMutationError(err, "collab.response_status");
      setStatusError(errorMessage(err, "Could not update the response."));
    },
  });

  const [crewPromptResponseId, setCrewPromptResponseId] = useState<number | null>(null);
  const acceptAndInvite = useMutation({
    mutationFn: (input: AcceptInput) => client.acceptAndInvite(input),
    onSuccess: (result) => {
      setCrewPromptResponseId(null);
      setStatusError(null);
      void invalidateResponses();
      if (result.createdTeam || result.teamId !== team?.id) {
        void invalidatePost();
        void queryClient.invalidateQueries({ queryKey: orpc.listMyTeams.key() });
      }
      if (result.createdTeam) {
        toast.success(`Accepted — and ${result.createdTeam.name} is now a team page.`);
      } else if (result.inviteId) {
        toast.success("Accepted and invited.");
      }
    },
    onError: (err) => {
      reportMutationError(err, "collab.accept_and_invite");
      setStatusError(errorMessage(err, "Could not accept the response."));
    },
  });

  // Accepting is a decision to work together; joining the team page is
  // the destination that makes it real. Rows accepted via ACCEPT ONLY keep
  // this as the follow-up.
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
      void invalidateResponses();
    },
    onError: (err) => {
      reportMutationError(err, "collab.invite_from_response");
      setInviteError(errorMessage(err, "Could not send the invite."));
    },
  });

  const busy = updateStatus.isPending || acceptAndInvite.isPending;

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
            <Censored>{resp.message}</Censored>
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
          {/* Available at every status, not just pending: the questions that
              settle a match ("can you also do UI?") come before the decision,
              and an accepted pair still uses it until they move to Discord. */}
          <ResponseThreadPanel
            responseId={resp.id}
            commentCount={resp.threadCommentCount}
            counterpartyLabel={resp.responderUsername ? `@${resp.responderUsername}` : undefined}
          />
          {resp.status === "pending" ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {team ? (
                  <>
                    <Button
                      size="xs"
                      onClick={() =>
                        acceptAndInvite.mutate({
                          responseId: resp.id,
                          team: { id: team.id },
                          invite: true,
                        })
                      }
                      disabled={busy}
                      className="tracking-widest"
                    >
                      ACCEPT & INVITE
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        updateStatus.mutate({ responseId: resp.id, status: "accepted" })
                      }
                      disabled={busy}
                      title="Accept without a roster invite — you can invite them after"
                      className="tracking-widest"
                    >
                      ACCEPT ONLY
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setCrewPromptResponseId(crewPromptResponseId === resp.id ? null : resp.id)
                    }
                    disabled={busy}
                    className="tracking-widest"
                  >
                    ACCEPT
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => updateStatus.mutate({ responseId: resp.id, status: "declined" })}
                  disabled={busy}
                  className="tracking-widest"
                >
                  DECLINE
                </Button>
              </div>
              {!team && crewPromptResponseId === resp.id ? (
                <CrewOnAcceptPrompt
                  post={post}
                  responderLabel={resp.responderUsername ? `@${resp.responderUsername}` : "them"}
                  pending={acceptAndInvite.isPending}
                  onAccept={(choice) => acceptAndInvite.mutate({ responseId: resp.id, ...choice })}
                  onCancel={() => setCrewPromptResponseId(null)}
                />
              ) : null}
              {statusError &&
              (crewPromptResponseId === resp.id ||
                updateStatus.variables?.responseId === resp.id ||
                acceptAndInvite.variables?.responseId === resp.id) ? (
                <Text size="xs" className="text-destructive">
                  {statusError}
                </Text>
              ) : null}
            </div>
          ) : null}
          {resp.status === "accepted" ? (
            <DiscordMessageButton
              discordId={resp.responderDiscordId}
              discordUsername={resp.responderUsername}
              label="MESSAGE ON DISCORD"
              size="xs"
              className="self-start"
              personLabel={resp.responderUsername ? `@${resp.responderUsername}` : undefined}
            />
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

type CrewMode = "create" | "existing";

/**
 * The accept-time crew choice for a post with no team: start one (named
 * after the post, editable), use one the poster already has, or — solo
 * posts only — accept and talk. A team post with no team has no
 * accept-only path: the accept → roster rule stays hard there.
 */
function CrewOnAcceptPrompt({
  post,
  responderLabel,
  pending,
  onAccept,
  onCancel,
}: {
  post: ResponsePost;
  responderLabel: string;
  pending: boolean;
  onAccept: (choice: Pick<AcceptInput, "team" | "invite">) => void;
  onCancel: () => void;
}) {
  const { data: allMyTeams } = useQuery(orpc.listMyTeams.queryOptions({ input: {} }));
  const myTeams = allMyTeams?.filter((t) => !t.hidden) ?? [];
  const [mode, setMode] = useState<CrewMode>("create");
  const canAcceptOnly = Boolean(post.isIndividual);

  return (
    <Well variant="ghost" className="gap-3 border-primary/40 p-3">
      <Text size="xs" variant="muted">
        Accepting {responderLabel} — put them on a crew so they land on a roster.
      </Text>

      {myTeams.length > 0 ? (
        <SegmentedControl
          value={mode}
          onChange={(next) => setMode(next as CrewMode)}
          size="sm"
          priority="primary"
        >
          <SegmentedControl.Item value="create">START A CREW</SegmentedControl.Item>
          <SegmentedControl.Item value="existing">USE AN EXISTING TEAM</SegmentedControl.Item>
        </SegmentedControl>
      ) : null}

      {mode === "existing" && myTeams.length > 0 ? (
        <TeamPickerField
          value={undefined}
          onChange={(teamId) => {
            if (teamId) onAccept({ team: { id: teamId }, invite: true });
          }}
        />
      ) : (
        <CrewCreateInline
          initialName={post.projectName ?? post.title}
          submitLabel={(name) => `ACCEPT & INVITE TO "${name.toUpperCase()}"`}
          pending={pending}
          onSubmit={(name) => onAccept({ team: { create: { name } }, invite: true })}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canAcceptOnly ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={pending}
            onClick={() => onAccept({ team: null, invite: false })}
            title="Accept without a crew — you can attach one later"
            className="tracking-widest"
          >
            ACCEPT ONLY
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          onClick={onCancel}
          disabled={pending}
          className="tracking-widest"
        >
          CANCEL
        </Button>
      </div>
    </Well>
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
