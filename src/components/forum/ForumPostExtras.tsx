import {
  ArrowDown01Icon,
  ArrowLeft02Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  CheckmarkBadge01Icon,
  DiscordIcon,
  Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { TextAreaField, TextField } from "@/components/collab/CollabCreateFlyout/fields";
import {
  CommentAction,
  type CommentRow,
  type CommentRowExtras,
} from "@/components/comments/CommentThread";
import { commentThreadQueryKey } from "@/components/comments/CommentThread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Section } from "@/components/ui/section";
import { TimeAgo } from "@/components/ui/time-ago";
import { MentionText, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { errorMessage } from "@/lib/error-message";
import { forumPostLinkParams } from "@/lib/forum-posts";
import { useMemberIdentity } from "@/lib/hooks/use-member-identity";
import { toastMutationError } from "@/lib/mutation-errors";
import { profileLinkParams } from "@/lib/profile-links";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

import { FollowButton } from "./FollowButton";
import { type ForumPostDetail, forumSeriesQueryOptions, invalidateForum } from "./forum-queries";
import { useGuildGate } from "./guild-gate";

type SeriesContext = NonNullable<ForumPostDetail["series"]>;

/** Previous / next entry, under a devlog that sits in a series. */
export function SeriesNav({ series }: { series: SeriesContext }) {
  if (!series.prev && !series.next) return null;
  const tile =
    "flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-muted/40 bg-card px-4 py-3 transition-colors hover:border-primary/60";
  return (
    <nav aria-label={`${series.title} — more entries`} className="flex flex-col gap-2 sm:flex-row">
      {series.prev ? (
        <Link to="/forum/$postId" params={forumPostLinkParams(series.prev)} className={tile}>
          <MicroLabel as="span" className="flex items-center gap-1 uppercase">
            <HugeiconsIcon icon={ArrowLeft02Icon} size={12} />
            Previous entry
          </MicroLabel>
          <Text as="span" size="sm" bold ellipsis>
            {series.prev.title}
          </Text>
        </Link>
      ) : (
        <span className="hidden flex-1 sm:block" />
      )}
      {series.next ? (
        <Link
          to="/forum/$postId"
          params={forumPostLinkParams(series.next)}
          className={cn(tile, "sm:items-end sm:text-right")}
        >
          <MicroLabel as="span" className="flex items-center gap-1 uppercase">
            Next entry
            <HugeiconsIcon icon={ArrowRight02Icon} size={12} />
          </MicroLabel>
          <Text as="span" size="sm" bold ellipsis>
            {series.next.title}
          </Text>
        </Link>
      ) : null}
    </nav>
  );
}

/** The series' entries in the sidebar, with Follow and — for its crew — MANAGE. */
export function SeriesPanel({
  seriesId,
  currentPostId,
}: {
  seriesId: number;
  currentPostId: number;
}) {
  const { data: series } = useQuery(forumSeriesQueryOptions(seriesId));
  const [managing, setManaging] = useState(false);
  if (!series) return null;
  return (
    <Section
      id="series"
      title="SERIES"
      size="sm"
      action={
        series.viewer.canManage ? (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setManaging(true)}
            className="tracking-widest"
          >
            MANAGE
          </Button>
        ) : null
      }
    >
      <Well className="gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Text as="span" bold>
              {series.title}
            </Text>
            {series.description ? (
              <Text as="span" size="xs" variant="muted">
                {series.description}
              </Text>
            ) : null}
          </div>
          <FollowButton type="series" target={String(series.id)} size="xs" />
        </div>
        <ol className="flex flex-col gap-1">
          {series.entries.map((entry) => (
            <li key={entry.id}>
              <Link
                to="/forum/$postId"
                params={forumPostLinkParams(entry)}
                aria-current={entry.id === currentPostId ? "page" : undefined}
                className={cn(
                  "flex items-baseline gap-2 rounded px-2 py-1 text-sm transition-colors hover:bg-muted/20",
                  entry.id === currentPostId && "bg-muted/25 text-foreground",
                )}
              >
                <MicroLabel as="span" className="w-5 shrink-0 text-right tabular-nums">
                  {entry.seriesIndex}
                </MicroLabel>
                <span className="truncate">{entry.title}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Well>
      {series.viewer.canManage ? (
        <SeriesManageDialog series={series} open={managing} onClose={() => setManaging(false)} />
      ) : null}
    </Section>
  );
}

type SeriesDetail = NonNullable<Awaited<ReturnType<typeof client.getForumSeries>>>;

/** Rename, reorder, or — for whoever owns it — delete a series. */
function SeriesManageDialog({
  series,
  open,
  onClose,
}: {
  series: SeriesDetail;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { guard, onServerRefusal } = useGuildGate();
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description ?? "");
  const [order, setOrder] = useState(() => series.entries.map((e) => e.id));
  const byId = new Map(series.entries.map((e) => [e.id, e]));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.getForumSeries.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listForumSeries.key() });
    invalidateForum(queryClient);
    void queryClient.invalidateQueries({ queryKey: orpc.getForumPost.key() });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (title.trim() !== series.title || description.trim() !== (series.description ?? "")) {
        await client.updateForumSeries({
          seriesId: series.id,
          title: title.trim(),
          description: description.trim() || null,
        });
      }
      if (order.join() !== series.entries.map((e) => e.id).join()) {
        await client.reorderForumSeries({ seriesId: series.id, postIds: order });
      }
    },
    onSuccess: () => {
      refresh();
      toast.success("Series saved.");
      onClose();
    },
    onError: (error) => {
      if (onServerRefusal(error, "edit", () => save.mutate())) return;
      toastMutationError("forum.series_update")(error);
    },
  });

  const remove = useMutation({
    mutationFn: () => client.deleteForumSeries({ seriesId: series.id }),
    onSuccess: () => {
      refresh();
      toast.success("Series deleted. Its devlogs stay up.");
      onClose();
    },
    onError: toastMutationError("forum.series_delete"),
  });

  const move = (index: number, by: -1 | 1) =>
    setOrder((ids) => {
      const next = [...ids];
      const [id] = next.splice(index, 1);
      next.splice(index + by, 0, id!);
      return next;
    });

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title="Manage series"
      description="Rename this series, change its order, or delete it."
      footer={
        <div className="flex items-center justify-between gap-2 p-4">
          {series.viewer.canDelete ? (
            <Confirm
              variant="destructive"
              title="Delete this series?"
              message="The devlogs stay up; they just stop being numbered."
              confirmText="DELETE"
              onConfirm={() => remove.mutate()}
            >
              <Button variant="ghost" size="sm" className="tracking-widest text-destructive">
                DELETE SERIES
              </Button>
            </Confirm>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            onClick={() => guard("edit", () => save.mutate())}
            disabled={!title.trim() || save.isPending}
            className="tracking-widest"
          >
            {save.isPending ? "SAVING…" : "SAVE"}
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
        <TextField label="Title" value={title} onChange={setTitle} maxLength={80} />
        <TextAreaField
          label="Description"
          value={description}
          onChange={setDescription}
          maxLength={500}
          rows={2}
        />
        <div className="flex flex-col gap-1.5">
          <MicroLabel as="span" className="uppercase">
            Order
          </MicroLabel>
          <ol className="flex flex-col divide-y divide-dashed divide-muted/40 rounded border border-muted/40">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-2 px-3 py-2">
                <MicroLabel as="span" className="w-5 text-right tabular-nums">
                  {i + 1}
                </MicroLabel>
                <Text as="span" size="sm" ellipsis className="min-w-0 flex-1">
                  {byId.get(id)?.title}
                </Text>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                >
                  <HugeiconsIcon icon={ArrowUp01Icon} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => move(i, 1)}
                  disabled={i === order.length - 1}
                  aria-label="Move down"
                >
                  <HugeiconsIcon icon={ArrowDown01Icon} />
                </Button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </ResponsiveModal>
  );
}

/** The accepted answer, pinned under the question it solved. */
export function SolutionBlock({
  solution,
}: {
  solution: NonNullable<ForumPostDetail["solution"]>;
}) {
  const { name } = useMemberIdentity();
  const who = solution.author ? name(solution.author, "unknown") : "deleted user";
  return (
    <Well className="gap-2 border-success/40 p-4 backdrop-blur-none">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success" size="label">
          <HugeiconsIcon icon={Tick01Icon} />
          SOLUTION
        </Badge>
        <UserAvatar
          avatarUrl={solution.author?.avatarUrl}
          guildAvatarUrl={solution.author?.guildAvatarUrl}
          username={who}
          size={20}
        />
        {solution.author ? (
          <Link
            to="/profile/$userId"
            params={profileLinkParams(solution.author)}
            className="text-sm font-bold hover:text-primary"
          >
            {who}
          </Link>
        ) : (
          <Text as="span" size="sm" bold>
            {who}
          </Text>
        )}
        <MicroLabel as="span" className="ml-auto">
          <a href={`#comment-${solution.id}`} className="hover:text-foreground">
            <TimeAgo date={solution.createdAt} />
          </a>
        </MicroLabel>
      </div>
      <Text size="sm" className="whitespace-pre-wrap text-foreground/90">
        <MentionText>{solution.content}</MentionText>
      </Text>
    </Well>
  );
}

/**
 * The forum's hooks into the comment thread: mentions link, the accepted
 * answer carries its mark, and the asker (or staff) can mark a top-level
 * answer — or take the mark back.
 */
export function useForumCommentExtras(post: ForumPostDetail): CommentRowExtras {
  const queryClient = useQueryClient();
  const { guard, onServerRefusal } = useGuildGate();
  const solvedId = post.solution?.id ?? null;

  const mark = useMutation({
    mutationFn: (commentId: number | null) =>
      client.markForumSolution({ postId: post.id, commentId }),
    onSuccess: (_, commentId) => {
      invalidateForum(queryClient, post.id);
      void queryClient.invalidateQueries({
        queryKey: commentThreadQueryKey({ type: "forum_post", id: post.id }),
      });
      toast.success(commentId ? "Marked as the solution." : "Solution cleared.");
    },
    onError: (error, commentId) => {
      if (onServerRefusal(error, "solve", () => mark.mutate(commentId))) return;
      toast.error(errorMessage(error, "Couldn't change the solution — try again."));
    },
  });

  return {
    renderContent: (content) => <MentionText>{content}</MentionText>,
    badges: (comment: CommentRow) =>
      comment.id === solvedId ? (
        <Badge variant="success" size="label">
          <HugeiconsIcon icon={Tick01Icon} />
          SOLUTION
        </Badge>
      ) : null,
    actions: (comment: CommentRow) =>
      post.viewer.canMarkSolution && comment.parentId == null && !comment.tombstone ? (
        <CommentAction
          icon={CheckmarkBadge01Icon}
          label={comment.id === solvedId ? "UNMARK SOLUTION" : "MARK AS SOLUTION"}
          disabled={mark.isPending}
          onClick={() =>
            guard("solve", () => mark.mutate(comment.id === solvedId ? null : comment.id))
          }
        />
      ) : null,
  };
}

/** A devlog's editors: put it in `#devlogs`, or open it there. */
export function DiscordShareButton({ post }: { post: ForumPostDetail }) {
  const queryClient = useQueryClient();
  const { guard, onServerRefusal } = useGuildGate();
  const share = post.viewer.discordShare;
  const mutation = useMutation({
    mutationFn: () => client.shareForumPostToDiscord({ postId: post.id }),
    onSuccess: () => {
      invalidateForum(queryClient, post.id);
      toast.success("Shared to #devlogs.");
    },
    onError: (error) => {
      if (onServerRefusal(error, "share", () => mutation.mutate())) return;
      toast.error(errorMessage(error, "Discord didn't take it — try again."));
    },
  });
  if (!share || post.visibility !== "visible") return null;
  if (share.live && share.messageUrl) {
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <a
            href={share.messageUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in #devlogs"
          />
        }
        className="tracking-widest"
      >
        <HugeiconsIcon icon={DiscordIcon} />
        IN #DEVLOGS
      </Button>
    );
  }
  if (!share.available) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => guard("share", () => mutation.mutate())}
      disabled={mutation.isPending}
      className="tracking-widest"
    >
      <HugeiconsIcon icon={DiscordIcon} />
      {mutation.isPending ? "SHARING…" : "SHARE TO #DEVLOGS"}
    </Button>
  );
}
