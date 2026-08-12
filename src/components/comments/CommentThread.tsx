import {
  ArrowTurnBackwardIcon,
  Delete02Icon,
  Flag02Icon,
  Notification03Icon,
  NotificationOff03Icon,
  PencilEdit01Icon,
  Sent02Icon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import type { SubjectRef } from "@/lib/comment-subjects";
import { timeAgo } from "@/lib/format-time";
import { profileLinkParams } from "@/lib/profile-links";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

type ThreadResponse = Awaited<ReturnType<typeof client.listComments>>;
type CommentRow = ThreadResponse["comments"][number];

/** Indentation stops here; deeper replies flatten with an @-mention chip. */
const MAX_VISUAL_DEPTH = 3;
/** Replies shown per chain before the "show more" control. */
const CHAIN_PREVIEW = 3;

const PAGE_SIZE = 20;

export function commentThreadQueryKey(subject: SubjectRef) {
  return ["listComments", subject.type, subject.id] as const;
}

/**
 * The shared comment surface: composer, tree, moderation controls. The
 * page hosting it supplies the section chrome via `shell` so collab posts
 * and profile walls each keep their own heading conventions around the
 * same machinery.
 */
export function CommentThread({
  subject,
  maxLength,
  placeholder = "Write a comment…",
  emptyLabel = "NO COMMENTS YET",
  emptyHint = "Start the conversation.",
  shell,
}: {
  subject: SubjectRef;
  maxLength: number;
  placeholder?: string;
  emptyLabel?: string;
  emptyHint?: string;
  shell?: (content: React.ReactNode, count: number) => React.ReactElement | null;
}) {
  const { session } = useStore(authStore);
  const viewerId = session?.user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = commentThreadQueryKey(subject);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: number | undefined }) =>
      client.listComments({ subject, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const first = data?.pages[0];
  const commentCount = first?.commentCount ?? 0;
  const commentingEnabled = first?.commentingEnabled ?? true;
  const locked = first?.thread?.lockedAt != null;
  const subscribed = first?.thread?.subscribed ?? false;
  const muted = first?.thread?.muted ?? false;
  const viewerIsStaff = first?.viewerIsStaff ?? false;

  const { roots, chains, byId } = useMemo(() => {
    const all = (data?.pages ?? []).flatMap((p) => p.comments);
    const byId = new Map(all.map((c) => [c.id, c]));
    const roots = all.filter((c) => c.parentId == null);
    const chains = new Map<number, CommentRow[]>();
    for (const c of all) {
      if (c.rootId == null) continue;
      const chain = chains.get(c.rootId) ?? [];
      chain.push(c);
      chains.set(c.rootId, chain);
    }
    for (const chain of chains.values()) chain.sort((a, b) => a.id - b.id);
    return { roots, chains, byId };
  }, [data]);

  const subscription = useMutation({
    mutationFn: (nextMuted: boolean) => client.setThreadSubscription({ subject, muted: nextMuted }),
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  const lock = useMutation({
    mutationFn: (nextLocked: boolean) => client.lockThread({ subject, locked: nextLocked }),
    onSuccess: invalidate,
    onError: (err: Error) => toast.error(err.message),
  });

  const content = (
    <div className="flex flex-col gap-3">
      {viewerId && (subscribed || viewerIsStaff) ? (
        <div className="flex items-center justify-end gap-2">
          {subscribed ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => subscription.mutate(!muted)}
              disabled={subscription.isPending}
              title={muted ? "Turn thread notifications back on" : "Mute this thread"}
              className="tracking-widest"
            >
              <HugeiconsIcon icon={muted ? NotificationOff03Icon : Notification03Icon} size={12} />
              {muted ? "MUTED" : "FOLLOWING"}
            </Button>
          ) : null}
          {viewerIsStaff ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => lock.mutate(!locked)}
              disabled={lock.isPending}
              title={locked ? "Unlock this thread" : "Lock this thread"}
              className="tracking-widest"
            >
              <HugeiconsIcon icon={SquareLock01Icon} size={12} />
              {locked ? "UNLOCK" : "LOCK"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {locked ? (
        <Well variant="ghost" className="items-center gap-1 p-4 backdrop-blur-none">
          <MicroLabel>THREAD LOCKED BY STAFF</MicroLabel>
        </Well>
      ) : viewerId && commentingEnabled ? (
        <Composer
          subject={subject}
          maxLength={maxLength}
          placeholder={placeholder}
          onPosted={invalidate}
        />
      ) : null}

      {isLoading ? (
        <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
          <MicroLabel>LOADING…</MicroLabel>
        </Well>
      ) : roots.length === 0 ? (
        <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
          <MicroLabel>{emptyLabel}</MicroLabel>
          <Text size="xs" variant="muted">
            {emptyHint}
          </Text>
        </Well>
      ) : (
        <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
          {roots.map((root) => (
            <CommentChain
              key={root.id}
              root={root}
              chain={chains.get(root.id) ?? []}
              byId={byId}
              subject={subject}
              maxLength={maxLength}
              locked={locked}
              commentingEnabled={commentingEnabled}
              viewerId={viewerId}
              onChange={invalidate}
            />
          ))}
        </Well>
      )}

      {hasNextPage ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="self-center tracking-widest"
        >
          {isFetchingNextPage ? "LOADING…" : "SHOW OLDER COMMENTS"}
        </Button>
      ) : null}
    </div>
  );

  return shell ? shell(content, commentCount) : content;
}

function Composer({
  subject,
  maxLength,
  placeholder,
  parentId,
  autoFocus,
  onPosted,
  onCancel,
}: {
  subject: SubjectRef;
  maxLength: number;
  placeholder: string;
  parentId?: number;
  autoFocus?: boolean;
  onPosted: () => void;
  onCancel?: () => void;
}) {
  const [content, setContent] = useState("");

  const post = useMutation({
    mutationFn: () => client.createComment({ subject, parentId, content: content.trim() }),
    onSuccess: () => {
      setContent("");
      onPosted();
      onCancel?.();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remaining = maxLength - content.length;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        rows={parentId ? 2 : 3}
        maxLength={maxLength}
        autoFocus={autoFocus}
      />
      <div className="flex items-center justify-between gap-2">
        <MicroLabel as="span" className={cn(remaining < 40 && "text-warning")}>
          {remaining}
        </MicroLabel>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button variant="ghost" size="sm" onClick={onCancel} className="tracking-widest">
              CANCEL
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => post.mutate()}
            disabled={!content.trim() || post.isPending}
            className="tracking-widest"
          >
            <HugeiconsIcon icon={Sent02Icon} size={12} />
            {post.isPending ? "POSTING…" : parentId ? "REPLY" : "POST"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CommentChain({
  root,
  chain,
  byId,
  subject,
  maxLength,
  locked,
  commentingEnabled,
  viewerId,
  onChange,
}: {
  root: CommentRow;
  chain: CommentRow[];
  byId: Map<number, CommentRow>;
  subject: SubjectRef;
  maxLength: number;
  locked: boolean;
  commentingEnabled: boolean;
  viewerId: string | null;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [extraReplies, setExtraReplies] = useState<CommentRow[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  const known = useMemo(() => {
    const seen = new Set(chain.map((c) => c.id));
    return [...chain, ...extraReplies.filter((r) => !seen.has(r.id))].sort((a, b) => a.id - b.id);
  }, [chain, extraReplies]);

  const visible = expanded ? known : known.slice(0, CHAIN_PREVIEW);
  const hiddenCount = known.length - visible.length;
  const canFetchMore = root.hasMoreReplies && extraReplies.length === 0;

  const loadRest = async () => {
    setExpanded(true);
    if (!canFetchMore) return;
    setLoadingMore(true);
    try {
      // One chain never realistically exceeds this; deeper paging can
      // reuse the cursor if it ever does.
      const res = await client.listReplies({
        rootId: root.id,
        cursor: chain.at(-1)?.id,
        limit: 100,
      });
      setExtraReplies(res.comments);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col">
      <CommentItem
        comment={root}
        byId={byId}
        subject={subject}
        maxLength={maxLength}
        locked={locked}
        commentingEnabled={commentingEnabled}
        viewerId={viewerId}
        onChange={onChange}
      />
      {visible.map((reply) => (
        <CommentItem
          key={reply.id}
          comment={reply}
          byId={byId}
          subject={subject}
          maxLength={maxLength}
          locked={locked}
          commentingEnabled={commentingEnabled}
          viewerId={viewerId}
          onChange={onChange}
        />
      ))}
      {hiddenCount > 0 || canFetchMore ? (
        <button
          type="button"
          onClick={loadRest}
          disabled={loadingMore}
          className="px-4 pt-1 pb-3 text-left font-mono text-[10px] tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
          style={{ paddingLeft: `${indentPx(1)}px` }}
        >
          {loadingMore
            ? "LOADING…"
            : hiddenCount > 0
              ? `SHOW ${hiddenCount} MORE ${hiddenCount === 1 ? "REPLY" : "REPLIES"}`
              : "SHOW MORE REPLIES"}
        </button>
      ) : null}
    </div>
  );
}

function indentPx(depth: number): number {
  return 16 + Math.min(depth, MAX_VISUAL_DEPTH) * 20;
}

function CommentItem({
  comment,
  byId,
  subject,
  maxLength,
  locked,
  commentingEnabled,
  viewerId,
  onChange,
}: {
  comment: CommentRow;
  byId: Map<number, CommentRow>;
  subject: SubjectRef;
  maxLength: number;
  locked: boolean;
  commentingEnabled: boolean;
  viewerId: string | null;
  onChange: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");

  const edit = useMutation({
    mutationFn: () => client.editComment({ commentId: comment.id, content: editDraft.trim() }),
    onSuccess: () => {
      setEditing(false);
      onChange();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => client.deleteComment({ commentId: comment.id }),
    onSuccess: onChange,
    onError: (err: Error) => toast.error(err.message),
  });

  const report = useMutation({
    mutationFn: () => client.reportComment({ commentId: comment.id, reason: reportReason.trim() }),
    onSuccess: () => {
      setReporting(false);
      setReportReason("");
      toast.success("Report sent — staff will take a look.");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const indent = indentPx(comment.depth);
  // Flattened replies name who they answer, since indentation stops.
  const flattenedParentName =
    comment.depth > MAX_VISUAL_DEPTH && comment.parentId
      ? (byId.get(comment.parentId)?.author?.name ?? null)
      : null;

  if (comment.hidden) {
    return (
      <div className="px-4 py-2.5" style={{ paddingLeft: `${indent}px` }}>
        <Text size="xs" variant="muted" className="italic">
          Comment hidden — from someone you've blocked.
        </Text>
      </div>
    );
  }

  const authorName = comment.author?.name ?? "Deleted User";

  return (
    <div
      id={`comment-${comment.id}`}
      className="flex flex-col gap-2 px-4 py-3"
      style={{ paddingLeft: `${indent}px` }}
    >
      <div className="flex items-center gap-2">
        <UserAvatar avatarUrl={comment.author?.avatarUrl ?? null} username={authorName} size={24} />
        {comment.author ? (
          <RouterLink
            to="/profile/$userId"
            params={profileLinkParams({ id: comment.author.id, urlStub: comment.author.urlStub })}
            className="font-mono text-[10px] tracking-widest uppercase transition-colors hover:text-primary"
          >
            {authorName}
          </RouterLink>
        ) : (
          <MicroLabel as="span">{authorName}</MicroLabel>
        )}
        {flattenedParentName ? (
          <MicroLabel as="span" className="text-primary/70">
            → @{flattenedParentName}
          </MicroLabel>
        ) : null}
        <MicroLabel as="span" className="ml-auto shrink-0">
          {timeAgo(comment.createdAt)}
          {comment.editedAt ? " · EDITED" : ""}
        </MicroLabel>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            rows={3}
            maxLength={maxLength}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(false)}
              className="tracking-widest"
            >
              CANCEL
            </Button>
            <Button
              size="sm"
              onClick={() => edit.mutate()}
              disabled={!editDraft.trim() || edit.isPending}
              className="tracking-widest"
            >
              {edit.isPending ? "SAVING…" : "SAVE"}
            </Button>
          </div>
        </div>
      ) : comment.tombstone ? (
        <Text size="sm" variant="muted" className="italic">
          {comment.tombstone === "author" ? "[removed by author]" : "[removed]"}
        </Text>
      ) : (
        <Text size="sm" className="whitespace-pre-wrap text-foreground/90">
          {comment.content}
        </Text>
      )}

      {viewerId && !editing && !comment.tombstone ? (
        <div className="flex items-center gap-1">
          {!locked && commentingEnabled ? (
            <CommentAction
              icon={ArrowTurnBackwardIcon}
              label="REPLY"
              onClick={() => setReplying((v) => !v)}
            />
          ) : null}
          {comment.viewer.canEdit && !locked ? (
            <CommentAction
              icon={PencilEdit01Icon}
              label="EDIT"
              onClick={() => {
                setEditDraft(comment.content ?? "");
                setEditing(true);
              }}
            />
          ) : null}
          {comment.viewer.canDelete ? (
            <CommentAction
              icon={Delete02Icon}
              label="DELETE"
              onClick={() => {
                if (window.confirm("Remove this comment?")) remove.mutate();
              }}
            />
          ) : null}
          {!comment.viewer.isMine ? (
            <CommentAction
              icon={Flag02Icon}
              label="REPORT"
              onClick={() => setReporting((v) => !v)}
            />
          ) : null}
        </div>
      ) : null}

      {reporting ? (
        <div className="flex items-center gap-2">
          <Textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="What's wrong with this comment?"
            rows={1}
            maxLength={1000}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => report.mutate()}
            disabled={!reportReason.trim() || report.isPending}
            className="tracking-widest"
          >
            {report.isPending ? "SENDING…" : "SEND"}
          </Button>
        </div>
      ) : null}

      {replying ? (
        <Composer
          subject={subject}
          maxLength={maxLength}
          placeholder={`Reply to ${authorName}…`}
          parentId={comment.id}
          autoFocus
          onPosted={onChange}
          onCancel={() => setReplying(false)}
        />
      ) : null}
    </div>
  );
}

function CommentAction({
  icon,
  label,
  onClick,
}: {
  icon: typeof Flag02Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:text-primary"
    >
      <HugeiconsIcon icon={icon} size={11} />
      {label}
    </button>
  );
}
