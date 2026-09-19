import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ModerationShell, ReasonField } from "@/components/moderation/ModerationShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Confirm } from "@/components/ui/confirm";
import { MicroLabel, Text } from "@/components/ui/typography";
import { errorMessage } from "@/lib/error-message";
import { reportMutationError } from "@/lib/product-insights";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

import type { CollabPostDetailData } from "./collab-post-data";

/**
 * MODERATE affordance for the post detail's action row. Renders nothing
 * for non-staff viewers (and while the staff check loads); staff get the
 * button plus the flyout. Post moderation is staff-direct — closing is
 * urgent and reversible, so nothing here goes through the proposal queue.
 */
export function CollabPostModerateButton({
  post,
  onGone,
}: {
  post: CollabPostDetailData;
  onGone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: staff } = useQuery({
    queryKey: ["getStaffStatus"],
    queryFn: () => client.getStaffStatus(),
  });

  if (!staff?.isStaff) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <span className="tracking-widest">MODERATE</span>
      </Button>
      <CollabPostModerationFlyout
        open={open}
        onClose={() => setOpen(false)}
        post={post}
        onGone={onGone}
      />
    </>
  );
}

/**
 * Staff moderation surface for a collab post. Close/reopen and delete
 * are staff-direct; every action requires a reason and lands in the
 * moderation log.
 */
export function CollabPostModerationFlyout({
  open,
  onClose,
  post,
  onGone,
}: {
  open: boolean;
  onClose: () => void;
  post: CollabPostDetailData;
  onGone: () => void;
}) {
  const qc = useQueryClient();
  const { queryKey } = orpc.getPost.queryOptions({ input: { postId: post.id } });
  const invalidate = () => void qc.invalidateQueries({ queryKey });

  return (
    <ModerationShell
      open={open}
      onClose={onClose}
      title={`Moderate "${post.title}"`}
      description="Staff moderation actions for this post."
      tabs={[
        {
          key: "status",
          label: "STATUS",
          content: <StatusSection post={post} onChanged={invalidate} />,
        },
        {
          key: "discord",
          label: "DISCORD",
          content: <DiscordSection post={post} />,
        },
        {
          key: "delete",
          label: "DELETE",
          content: (
            <DeleteSection
              post={post}
              onGone={() => {
                void qc.invalidateQueries({ queryKey: ["listPosts"] });
                onClose();
                onGone();
              }}
            />
          ),
        },
      ]}
    />
  );
}

function StatusSection({ post, onChanged }: { post: CollabPostDetailData; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const isClosed = post.status === "party_full";

  const close = useMutation({
    mutationFn: () => client.closePost({ postId: post.id, reason: reason.trim() }),
    onSuccess: () => {
      toast.success("Post closed — the author was notified.");
      setReason("");
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.post_close");
      toast.error(errorMessage(err));
    },
  });
  const reopen = useMutation({
    mutationFn: () => client.reopenPost({ postId: post.id, reason: reason.trim() || undefined }),
    onSuccess: () => {
      toast.success("Post reopened.");
      setReason("");
      onChanged();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.post_reopen");
      toast.error(errorMessage(err));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        {isClosed ? "Currently closed — not taking applications." : "Currently open — recruiting."}
      </Text>
      {isClosed ? (
        <div>
          <Confirm
            title="Reopen this post?"
            message="The post starts a fresh recruiting window."
            confirmText="REOPEN"
            onConfirm={async () => {
              await reopen.mutateAsync();
            }}
          >
            <Button variant="outline" size="sm" disabled={reopen.isPending}>
              REOPEN POST
            </Button>
          </Confirm>
        </div>
      ) : (
        <>
          <ReasonField value={reason} onChange={setReason} hint="shown to the author" />
          <div>
            <Confirm
              variant="destructive"
              title="Close this post?"
              message="Recruiting stops and the author is notified."
              confirmText="CLOSE"
              onConfirm={async () => {
                await close.mutateAsync();
              }}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={reason.trim().length === 0 || close.isPending}
              >
                CLOSE POST
              </Button>
            </Confirm>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The force-send: put a post in the guild's collab feed on the author's
 * behalf. Every automatic path can fail in a way nothing retries — a
 * revoked bot permission, a Discord outage that outlasts the close — and
 * this is the hand crank for all of them.
 *
 * Clearing the author's cooldown is the separate, opt-in half: it hands
 * back a six-hour window they spent on a mirror that never landed, and
 * it's the only thing here that changes what *they* can do next.
 */
function DiscordSection({ post }: { post: CollabPostDetailData }) {
  const [clearCooldown, setClearCooldown] = useState(false);
  const isClosed = post.status !== "recruiting";

  const share = useMutation({
    mutationFn: () =>
      client.shareToDiscord({ postId: post.id, clearAuthorCooldown: clearCooldown }),
    onSuccess: () => {
      toast.success(
        clearCooldown
          ? "Posted to the collab feed — the author's cooldown is clear."
          : "Posted to the collab feed.",
      );
      setClearCooldown(false);
    },
    onError: (err) => {
      reportMutationError(err, "moderation.post_share_discord");
      toast.error(errorMessage(err));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <Text size="xs" variant="muted">
        {isClosed
          ? "A closed post can't be announced — reopen it on the STATUS tab first."
          : "Posts this to the guild's collab feed, or rewrites the message already there. The author is notified either way, and the action lands in the moderation log."}
      </Text>
      <label htmlFor="collab-share-clear-cooldown" className="flex items-center gap-2">
        <Checkbox
          id="collab-share-clear-cooldown"
          checked={clearCooldown}
          disabled={isClosed}
          onCheckedChange={(checked) => setClearCooldown(!!checked)}
        />
        <MicroLabel as="span">ALSO CLEAR THE AUTHOR'S COOLDOWN</MicroLabel>
      </label>
      <div>
        <Confirm
          variant={clearCooldown ? "destructive" : "default"}
          title="Post this to the collab feed?"
          message={
            clearCooldown
              ? "The guild sees it now, and the author gets their announcement window back."
              : "The guild sees it now, under the author's name."
          }
          confirmText="POST IT"
          onConfirm={async () => {
            await share.mutateAsync();
          }}
        >
          <Button variant="outline" size="sm" disabled={isClosed || share.isPending}>
            POST TO DISCORD
          </Button>
        </Confirm>
      </div>
    </section>
  );
}

function DeleteSection({ post, onGone }: { post: CollabPostDetailData; onGone: () => void }) {
  const [reason, setReason] = useState("");
  const [armed, setArmed] = useState(false);

  const mutation = useMutation({
    mutationFn: () => client.deletePost({ postId: post.id, reason: reason.trim() }),
    onSuccess: () => {
      toast.success("Post deleted.");
      onGone();
    },
    onError: (err) => {
      reportMutationError(err, "moderation.post_delete");
      toast.error(errorMessage(err));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <ReasonField value={reason} onChange={setReason} hint="lands in the moderation log" />
      <div className="flex flex-wrap items-center gap-2">
        {armed ? (
          <>
            <Confirm
              variant="destructive"
              title="Delete this post permanently?"
              message="Applications go with it. This can't be undone."
              confirmText="DELETE POST"
              onConfirm={async () => {
                await mutation.mutateAsync();
              }}
            >
              <Button
                variant="destructive"
                size="sm"
                disabled={reason.trim().length === 0 || mutation.isPending}
              >
                REALLY DELETE
              </Button>
            </Confirm>
            <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
              CANCEL
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={reason.trim().length === 0}
            onClick={() => setArmed(true)}
          >
            DELETE POST
          </Button>
        )}
      </div>
    </section>
  );
}
