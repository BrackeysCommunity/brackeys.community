import { Delete02Icon, PencilEdit01Icon, Sent02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { DiscordMessageButton } from "@/components/ui/discord-message-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link as TextLink, MicroLabel, Text } from "@/components/ui/typography";
import { timeAgo } from "@/lib/format-time";
import { Censored } from "@/lib/hooks/use-censored";
import { client, orpc } from "@/orpc/client";

import { ResponseThreadPanel } from "./ResponseThreadPanel";

interface CollabPostResponseFormProps {
  postId: number;
}

export interface ViewerResponse {
  id: number;
  message: string;
  portfolioUrl: string | null;
  status: string;
  createdAt: Date | string | null;
  /** Messages in the private thread with the post author. */
  threadCommentCount: number;
}

const RESPONSE_STATUS_BADGE: Record<
  string,
  { label: string; variant: "secondary" | "success" | "destructive" }
> = {
  pending: { label: "PENDING", variant: "secondary" },
  accepted: { label: "ACCEPTED", variant: "success" },
  declined: { label: "DECLINED", variant: "destructive" },
};

/**
 * What a returning responder sees in place of the blank form: the
 * application they already sent, where it stands, and — while it's still
 * pending — the controls to revise or withdraw it. Reviewed responses
 * are frozen readouts (the server enforces the same rule).
 */
export function ViewerResponseCard({
  response,
  postId,
  authorDiscordId,
  authorDiscordUsername,
}: {
  response: ViewerResponse;
  postId: number;
  /** The post author's Discord id — the server only sends it once this
   *  response is accepted, so no extra gate is needed here. */
  authorDiscordId?: string | null;
  authorDiscordUsername?: string | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(response.message);
  const [portfolioUrl, setPortfolioUrl] = useState(response.portfolioUrl ?? "");
  const [error, setError] = useState("");

  // Editing or withdrawing changes the viewer's own application, and a
  // withdrawal also moves the post's response count.
  const invalidatePost = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.getPostViewerState.queryOptions({ input: { postId } }).queryKey,
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
      }),
    ]);
  };

  const update = useMutation({
    mutationFn: () =>
      client.updateMyResponse({ postId, message, portfolioUrl: portfolioUrl || undefined }),
    onSuccess: async () => {
      setEditing(false);
      setError("");
      await invalidatePost();
    },
    onError: (err: Error) => setError(err.message),
  });

  const withdraw = useMutation({
    mutationFn: () => client.withdrawResponse({ postId }),
    onSuccess: invalidatePost,
    onError: (err: Error) => setError(err.message),
  });

  const status = RESPONSE_STATUS_BADGE[response.status] ?? RESPONSE_STATUS_BADGE.pending!;
  const pending = response.status === "pending";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <MicroLabel as="span">YOU RESPONDED</MicroLabel>
        <Badge variant={status.variant} size="label">
          {status.label}
        </Badge>
        {response.createdAt ? (
          <MicroLabel as="span" className="ml-auto">
            {timeAgo(response.createdAt)}
          </MicroLabel>
        ) : null}
      </div>

      {editing ? (
        <>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={2000}
          />
          <Input
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
            placeholder="Portfolio URL (optional)"
          />
        </>
      ) : (
        <>
          <Text size="sm" className="whitespace-pre-wrap text-foreground/90">
            <Censored>{response.message}</Censored>
          </Text>
          {response.portfolioUrl ? (
            <TextLink
              href={response.portfolioUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              className="self-start"
            >
              {response.portfolioUrl.replace(/^https?:\/\//, "")} →
            </TextLink>
          ) : null}
        </>
      )}

      {error ? (
        <Text size="xs" variant="danger">
          {error}
        </Text>
      ) : null}

      {/* The responder's half of the private channel. Offered while pending
          too — that is when a question is worth asking, and it is the only
          way to reach the author before a decision without public comments. */}
      <ResponseThreadPanel
        responseId={response.id}
        commentCount={response.threadCommentCount}
        counterpartyLabel="the author"
      />

      {response.status === "accepted" ? (
        <DiscordMessageButton
          discordId={authorDiscordId}
          discordUsername={authorDiscordUsername}
          label="MESSAGE ON DISCORD"
          size="xs"
          className="mt-1 self-start"
        />
      ) : null}

      {pending ? (
        <div className="flex items-center gap-2 pt-1">
          {editing ? (
            <>
              <Button
                size="xs"
                onClick={() => update.mutate()}
                disabled={!message.trim() || update.isPending}
                className="tracking-widest"
              >
                {update.isPending ? "SAVING…" : "SAVE"}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setEditing(false);
                  setMessage(response.message);
                  setPortfolioUrl(response.portfolioUrl ?? "");
                }}
                className="tracking-widest"
              >
                CANCEL
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={() => setEditing(true)}
                className="tracking-widest"
              >
                <HugeiconsIcon icon={PencilEdit01Icon} size={12} />
                EDIT
              </Button>
              <Confirm
                variant="destructive"
                title="Withdraw your response?"
                message="The poster won't see it anymore."
                confirmText="WITHDRAW"
                onConfirm={() => withdraw.mutate()}
              >
                <Button
                  variant="outline"
                  size="xs"
                  disabled={withdraw.isPending}
                  className="tracking-widest text-destructive"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} />
                  WITHDRAW
                </Button>
              </Confirm>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Apply to this post" inline form — used inside the post popover for
 * non-owner viewers. Submits via `respondToPost` and invalidates the
 * `getPost` cache so the owner sees the new response immediately.
 */
export function CollabPostResponseForm({ postId }: CollabPostResponseFormProps) {
  const [message, setMessage] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const queryClient = useQueryClient();

  const respondMutation = useMutation({
    mutationFn: () =>
      client.respondToPost({
        postId,
        message,
        portfolioUrl: portfolioUrl || undefined,
      }),
    onSuccess: async () => {
      setSuccess(true);
      setMessage("");
      setPortfolioUrl("");
      // The new application is the viewer's own state; the post's public
      // core only moves by its response count.
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.getPostViewerState.queryOptions({ input: { postId } }).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey,
        }),
      ]);
    },
    onError: (err: Error) => setError(err.message),
  });

  if (success) {
    return (
      <Text size="xs" variant="success" className="tracking-widest uppercase">
        Response sent.
      </Text>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write your application message…"
        rows={4}
        maxLength={2000}
      />
      <Input
        value={portfolioUrl}
        onChange={(e) => setPortfolioUrl(e.target.value)}
        placeholder="Portfolio URL (optional)"
      />
      {error ? (
        <Text size="xs" variant="danger">
          {error}
        </Text>
      ) : null}
      <Button
        variant="default"
        size="sm"
        onClick={() => respondMutation.mutate()}
        disabled={!message.trim() || respondMutation.isPending}
        className="tracking-widest"
      >
        <HugeiconsIcon icon={Sent02Icon} size={12} />
        {respondMutation.isPending ? "SENDING…" : "SEND RESPONSE"}
      </Button>
    </div>
  );
}
