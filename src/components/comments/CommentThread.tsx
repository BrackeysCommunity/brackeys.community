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
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Link as RouterLink } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { ReportDialog } from "@/components/ui/report-dialog";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import type { SubjectRef } from "@/lib/comment-subjects";
import { timeAgo } from "@/lib/format-time";
import { Censored } from "@/lib/hooks/use-censored";
import { profileLinkParams } from "@/lib/profile-links";
import { toast } from "@/lib/toast";
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

type ThreadData = InfiniteData<ThreadResponse>;

/**
 * The placeholder row shown while createComment is in flight; the
 * post-success refetch swaps it for the real row. The temp id is a ms
 * timestamp — far above any serial comment id, so a reply sorts to the
 * end of its chain where new replies belong.
 */
function optimisticComment(
  user: { id: string; name?: string | null; image?: string | null },
  parent: CommentRow | undefined,
  content: string,
): CommentRow {
  return {
    id: Date.now(),
    parentId: parent?.id ?? null,
    rootId: parent ? (parent.rootId ?? parent.id) : null,
    depth: parent ? Math.min(parent.depth + 1, 8) : 0,
    content,
    tombstone: null,
    hidden: false,
    createdAt: new Date(),
    editedAt: null,
    replyCount: 0,
    author: { id: user.id, name: user.name ?? "You", avatarUrl: user.image ?? null, urlStub: null },
    viewer: { isMine: true, canEdit: true, canDelete: true },
  };
}

function withOptimisticComment(data: ThreadData, comment: CommentRow): ThreadData {
  return {
    ...data,
    pages: data.pages.map((page, i) =>
      i === 0
        ? {
            ...page,
            commentCount: page.commentCount + 1,
            // New top-level comments render newest-first; replies are
            // picked out of the page by rootId and sorted by id.
            comments:
              comment.parentId == null ? [comment, ...page.comments] : [...page.comments, comment],
          }
        : page,
    ),
  };
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
        <CommentThreadSkeleton />
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

/**
 * Holds the thread's height while the first page loads. Row 2 sits at
 * reply indent so the placeholder reads as a conversation rather than a
 * flat list — the same shape `CommentChain` renders into.
 */
function CommentThreadSkeleton() {
  return (
    <Well
      className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none"
      aria-hidden
    >
      {[0, 1, 0].map((depth, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 px-4 py-3"
          style={{ paddingLeft: `${16 + depth * 24}px` }}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="size-6 shrink-0 rounded-full bg-muted/50" />
            <Skeleton className="h-3 w-24 bg-muted/50" />
            <Skeleton className="ml-auto h-3 w-12 shrink-0 bg-muted/50" />
          </div>
          <SkeletonText lines={depth ? 1 : 2} />
        </div>
      ))}
    </Well>
  );
}

function Composer({
  subject,
  maxLength,
  placeholder,
  parent,
  autoFocus,
  onPosted,
  onCancel,
}: {
  subject: SubjectRef;
  maxLength: number;
  placeholder: string;
  parent?: CommentRow;
  autoFocus?: boolean;
  onPosted: () => void;
  onCancel?: () => void;
}) {
  const [content, setContent] = useState("");
  const queryClient = useQueryClient();
  const queryKey = commentThreadQueryKey(subject);
  const { session } = useStore(authStore);

  const post = useMutation({
    mutationFn: (body: string) =>
      client.createComment({ subject, parentId: parent?.id, content: body }),
    // Optimistic: the comment renders immediately; the server round trip
    // (rate limit, notification fan-out) reconciles behind it.
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<ThreadData>(queryKey);
      const user = session?.user;
      if (previous && user) {
        queryClient.setQueryData(
          queryKey,
          withOptimisticComment(previous, optimisticComment(user, parent, body)),
        );
      }
      const draft = content;
      setContent("");
      onCancel?.();
      return { previous, draft };
    },
    onError: (err: Error, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      if (ctx) setContent(ctx.draft);
      toast.error(err.message);
    },
    onSuccess: () => onPosted(),
  });

  const remaining = maxLength - content.length;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        rows={parent ? 2 : 3}
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
            onClick={() => post.mutate(content.trim())}
            disabled={!content.trim() || post.isPending}
            className="tracking-widest"
          >
            <HugeiconsIcon icon={Sent02Icon} size={12} />
            {post.isPending ? "POSTING…" : parent ? "REPLY" : "POST"}
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
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<number>>(new Set());

  const known = useMemo(() => {
    const seen = new Set(chain.map((c) => c.id));
    return [...chain, ...extraReplies.filter((r) => !seen.has(r.id))].sort((a, b) => a.id - b.id);
  }, [chain, extraReplies]);

  // byId from the page cache misses lazily-fetched extras; the chain-local
  // map covers every row this chain renders.
  const chainById = useMemo(() => {
    const m = new Map(byId);
    m.set(root.id, root);
    for (const c of known) m.set(c.id, c);
    return m;
  }, [byId, root, known]);

  const toggleCollapsed = (id: number) => {
    const reopening = collapsedIds.has(id);
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (reopening) next.delete(id);
      else next.add(id);
      return next;
    });
    // "SHOW n REPLIES" promises all n — lift the preview cap so the
    // reopened subtree isn't immediately re-hidden by it.
    if (reopening) setExpanded(true);
  };

  const [hoveredLineId, setHoveredLineId] = useState<number | null>(null);

  /** Walks parent links; true when any ancestor is collapsed. */
  const suppressed = (c: CommentRow): boolean => {
    let cur = c.parentId != null ? chainById.get(c.parentId) : undefined;
    while (cur) {
      if (collapsedIds.has(cur.id)) return true;
      cur = cur.parentId != null ? chainById.get(cur.parentId) : undefined;
    }
    return false;
  };

  const countDescendants = (id: number): number =>
    known.filter((c) => {
      let cur: CommentRow | undefined = c;
      while (cur) {
        if (cur.parentId === id) return true;
        cur = cur.parentId != null ? chainById.get(cur.parentId) : undefined;
      }
      return false;
    }).length;

  /** Line level → the ancestor that line descends from, for collapse. */
  const ancestorIdAt = (c: CommentRow) => (level: number) => {
    let cur = c.parentId != null ? chainById.get(c.parentId) : undefined;
    while (cur) {
      if (cur.depth === level) return cur.id;
      cur = cur.parentId != null ? chainById.get(cur.parentId) : undefined;
    }
    return undefined;
  };

  const rootCollapsed = collapsedIds.has(root.id);
  // Collapse filtering happens before the preview cap so collapsing a
  // subtree pulls later siblings up instead of leaving a short preview,
  // and the "show more" count only ever promises rows that will appear.
  const shown = known.filter((c) => !suppressed(c));
  const visible = expanded ? shown : shown.slice(0, CHAIN_PREVIEW);
  const hiddenCount = shown.length - visible.length;
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
        byId={chainById}
        subject={subject}
        maxLength={maxLength}
        locked={locked}
        commentingEnabled={commentingEnabled}
        viewerId={viewerId}
        onChange={onChange}
        collapsedDescendants={rootCollapsed ? countDescendants(root.id) : 0}
        onToggleCollapse={toggleCollapsed}
      />
      {!rootCollapsed &&
        visible.map((reply) => (
          <CommentItem
            key={reply.id}
            comment={reply}
            byId={chainById}
            subject={subject}
            maxLength={maxLength}
            locked={locked}
            commentingEnabled={commentingEnabled}
            viewerId={viewerId}
            onChange={onChange}
            ancestorIdAt={ancestorIdAt(reply)}
            collapsedDescendants={collapsedIds.has(reply.id) ? countDescendants(reply.id) : 0}
            onToggleCollapse={toggleCollapsed}
            trackHighlightId={hoveredLineId}
            onTrackHover={setHoveredLineId}
          />
        ))}
      {!rootCollapsed && (hiddenCount > 0 || canFetchMore) ? (
        <button
          type="button"
          onClick={loadRest}
          disabled={loadingMore}
          className="relative px-4 pt-1 pb-3 text-left font-mono text-[10px] tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
          style={{ paddingLeft: `${indentPx(1)}px` }}
        >
          <TrackLines
            depth={1}
            ancestorIdAt={(level) => (level === 0 ? root.id : undefined)}
            highlightId={hoveredLineId}
          />
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

/**
 * One vertical guide per ancestor level, aligned with that ancestor's
 * avatar's left edge so a chain reads as a thread. Host element must be
 * `relative`; the lines span its full height, so consecutive rows connect.
 *
 * With `ancestorIdAt`/`onCollapse` wired, each line becomes a click target
 * (16px hit area centered on the 1px line) that collapses that ancestor's
 * subtree — omit `onCollapse` where a nested button would be invalid.
 * Hover is reported upward via `onHover` so the chain can light the whole
 * column (`highlightId`) rather than just the hovered row's segment.
 */
function TrackLines({
  depth,
  ancestorIdAt,
  onCollapse,
  highlightId,
  onHover,
}: {
  depth: number;
  ancestorIdAt?: (level: number) => number | undefined;
  onCollapse?: (id: number) => void;
  highlightId?: number | null;
  onHover?: (id: number | null) => void;
}) {
  const levels = Math.min(depth, MAX_VISUAL_DEPTH);
  if (levels <= 0) return null;
  return (
    <>
      {Array.from({ length: levels }, (_, i) => {
        const ancestorId = ancestorIdAt?.(i);
        const lit = ancestorId != null && ancestorId === highlightId;
        const lineClass = cn(
          "border-l border-dashed transition-colors",
          lit ? "border-primary/70" : "border-muted/40",
        );
        if (ancestorId == null || !onCollapse) {
          return (
            <span
              key={i}
              aria-hidden
              className={cn("pointer-events-none absolute inset-y-0", lineClass)}
              style={{ left: `${indentPx(i)}px` }}
            />
          );
        }
        return (
          <button
            key={i}
            type="button"
            aria-label="Collapse thread"
            onClick={() => {
              onHover?.(null);
              onCollapse(ancestorId);
            }}
            onMouseEnter={() => onHover?.(ancestorId)}
            onMouseLeave={() => onHover?.(null)}
            className="absolute inset-y-0 w-4"
            style={{ left: `${indentPx(i) - 8}px` }}
          >
            <span className={cn("absolute inset-y-0 left-1/2", lineClass)} />
          </button>
        );
      })}
    </>
  );
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
  ancestorIdAt,
  collapsedDescendants = 0,
  onToggleCollapse,
  trackHighlightId,
  onTrackHover,
}: {
  comment: CommentRow;
  byId: Map<number, CommentRow>;
  subject: SubjectRef;
  maxLength: number;
  locked: boolean;
  commentingEnabled: boolean;
  viewerId: string | null;
  onChange: () => void;
  /** Maps a track-line level to the ancestor it belongs to. */
  ancestorIdAt?: (level: number) => number | undefined;
  /** Non-zero when this comment's subtree is collapsed under it. */
  collapsedDescendants?: number;
  onToggleCollapse?: (id: number) => void;
  /** Ancestor whose track line is hovered anywhere in the chain. */
  trackHighlightId?: number | null;
  onTrackHover?: (id: number | null) => void;
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
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
    mutationFn: (reason: string) => client.reportComment({ commentId: comment.id, reason }),
    onSuccess: () => toast.success("Report sent — staff will take a look."),
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
      <div className="relative px-4 py-2.5" style={{ paddingLeft: `${indent}px` }}>
        <TrackLines
          depth={comment.depth}
          ancestorIdAt={ancestorIdAt}
          onCollapse={onToggleCollapse}
          highlightId={trackHighlightId}
          onHover={onTrackHover}
        />
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
      className="relative flex flex-col gap-2 px-4 py-3"
      style={{ paddingLeft: `${indent}px` }}
    >
      <TrackLines
        depth={comment.depth}
        ancestorIdAt={ancestorIdAt}
        onCollapse={onToggleCollapse}
        highlightId={trackHighlightId}
        onHover={onTrackHover}
      />
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
          <Censored>{comment.content}</Censored>
        </Text>
      )}

      {viewerId && !editing && !comment.tombstone ? (
        <div className="-ml-1.5 flex items-center gap-1">
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
            <Confirm
              variant="destructive"
              title="Remove this comment?"
              confirmText="REMOVE"
              onConfirm={() => remove.mutate()}
            >
              <CommentAction icon={Delete02Icon} label="DELETE" />
            </Confirm>
          ) : null}
          {!comment.viewer.isMine ? (
            <ReportDialog
              title="Report this comment?"
              message="Tell staff what's wrong with it. Only staff see this."
              placeholder="What's wrong with this comment?"
              onSubmit={(reason) => report.mutateAsync(reason)}
            >
              <CommentAction icon={Flag02Icon} label="REPORT" />
            </ReportDialog>
          ) : null}
        </div>
      ) : null}

      {replying ? (
        <Composer
          subject={subject}
          maxLength={maxLength}
          placeholder={`Reply to ${authorName}…`}
          parent={comment}
          autoFocus
          onPosted={onChange}
          onCancel={() => setReplying(false)}
        />
      ) : null}

      {collapsedDescendants > 0 && onToggleCollapse ? (
        <button
          type="button"
          onClick={() => onToggleCollapse(comment.id)}
          className="self-start font-mono text-[10px] tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
        >
          SHOW {collapsedDescendants} {collapsedDescendants === 1 ? "REPLY" : "REPLIES"}
        </button>
      ) : null}
    </div>
  );
}

function CommentAction({
  icon,
  label,
  className,
  ...props
}: {
  icon: typeof Flag02Icon;
  label: string;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:text-primary",
        className,
      )}
    >
      <HugeiconsIcon icon={icon} size={11} />
      {label}
    </button>
  );
}
