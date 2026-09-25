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
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link as RouterLink, useLocation } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { RankBadge } from "@/components/ui/rank-badge";
import { ReportDialog } from "@/components/ui/report-dialog";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TimeAgo } from "@/components/ui/time-ago";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Censored } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { activeUserStore } from "@/lib/active-user-store";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import type { SubjectRef } from "@/lib/comment-subjects";
import { useMemberViewer } from "@/lib/hooks/use-member-identity";
import { isMultilineSubmitKey } from "@/lib/keyboard";
import {
  memberAvatarUrl,
  memberDisplayName,
  type MemberIdentityFields,
  type MemberViewer,
} from "@/lib/member-name";
import { toastMutationError } from "@/lib/mutation-errors";
import { nameGlowProps, resolveNameGlow } from "@/lib/name-glow";
import { reportMutationError } from "@/lib/product-insights";
import { profileLinkParams } from "@/lib/profile-links";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

type ThreadResponse = Awaited<ReturnType<typeof client.listComments>>;
export type CommentRow = ThreadResponse["comments"][number];

/** Indentation stops here; deeper replies flatten with an @-mention chip. */
const MAX_VISUAL_DEPTH = 3;
/** Replies shown per chain before the "show more" control. */
const CHAIN_PREVIEW = 3;

const PAGE_SIZE = 20;

/**
 * The comment a `#comment-<id>` deep link names — what a wall-note or
 * reply notification points at. The router scrolls to a hash once, when
 * the route settles; comments load after that, so reaching the row is
 * this file's job from here on.
 */
function useFocusedCommentId(): number | null {
  const hash = useLocation({ select: (l) => l.hash });
  const match = /^comment-(\d+)$/.exec(hash);
  return match ? Number(match[1]) : null;
}

/**
 * A host's own bar in front of posting — the forum's guild gate. `guard`
 * decides whether a submit goes ahead; `onServerRefusal` claims the
 * server's refusal (true) or leaves it to the usual toast (false).
 */
export type CommentGate = {
  guard: (run: () => void) => void;
  onServerRefusal: (error: unknown, retry: () => void) => boolean;
};

const CommentGateContext = createContext<CommentGate | null>(null);

/**
 * What a host adds to each row — the forum's accepted-answer mark and its
 * "Mark as solution" action, and `@mention` links in the text.
 */
export type CommentRowExtras = {
  badges?: (comment: CommentRow) => React.ReactNode;
  actions?: (comment: CommentRow) => React.ReactNode;
  /** Renders a comment's text; plain censored text by default. */
  renderContent?: (content: string) => React.ReactNode;
};

const CommentExtrasContext = createContext<CommentRowExtras>({});

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
  self:
    | (MemberIdentityFields & {
        guildRoles?: string[] | null;
        nameGlowColors?: string[] | null;
        nameGlowMotion?: string | null;
        isBooster?: boolean;
      })
    | null,
  viewer: MemberViewer,
  parent: CommentRow | undefined,
  content: string,
): CommentRow {
  // The row the server will send back names the author by the house rule,
  // so the optimistic one does too — `user.name` is the bare handle and
  // would flash a different name for a member with a nickname.
  const name = self ? memberDisplayName(self, viewer, user.name ?? "You") : (user.name ?? "You");
  const avatarUrl = (self ? memberAvatarUrl(self, viewer) : null) ?? user.image ?? null;
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
    // `avatarUrl` is already resolved through the in-guild rule above, so the
    // guild leg stays null rather than applying it a second time.
    author: {
      id: user.id,
      name,
      avatarUrl,
      guildAvatarUrl: null,
      guildRoles: self?.guildRoles ?? null,
      // Unset until the server row lands, so a booster's own pending comment
      // simply doesn't glow yet rather than guessing a colour.
      nameGlowColors: self?.nameGlowColors ?? null,
      nameGlowMotion: self?.nameGlowMotion ?? null,
      isBooster: self?.isBooster ?? false,
      urlStub: null,
    },
    byAuthor: false,
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
  renderEmpty,
  signInPrompt,
  shell,
  gate,
  extras,
}: {
  subject: SubjectRef;
  maxLength: number;
  placeholder?: string;
  emptyLabel?: string;
  emptyHint?: string;
  /** Replaces the default empty well, for a host with its own empty-state
   *  idiom. Told whether the viewer is signed in so it can offer the way in. */
  renderEmpty?: (ctx: { signedIn: boolean }) => React.ReactNode;
  /** When set, a signed-out viewer sees this line and a LOGIN button where
   *  the composer would be, instead of nothing. */
  signInPrompt?: string;
  shell?: (content: React.ReactNode, count: number) => React.ReactElement | null;
  gate?: CommentGate;
  extras?: CommentRowExtras;
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

  const focusId = useFocusedCommentId();
  // Which chain owns the deep-linked comment. Without it the paging below
  // has nothing to aim at, and a fragment left over from another thread
  // would walk this one to its end looking for a row that isn't here.
  const { data: focusLocation } = useQuery({
    queryKey: ["getCommentLocation", subject, focusId],
    queryFn: () => client.getCommentLocation({ subject, commentId: focusId! }),
    enabled: focusId != null,
    staleTime: Infinity,
  });
  const focusRootId = focusLocation?.rootId ?? null;

  // Roots page newest-first, so the target's chain is still unfetched
  // exactly while its id sits below the oldest root loaded.
  const oldestRootId = roots.length > 0 ? roots[roots.length - 1]!.id : null;
  const focusChainPending =
    focusRootId != null && oldestRootId != null && focusRootId < oldestRootId;
  useEffect(() => {
    if (focusChainPending && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [focusChainPending, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const subscription = useMutation({
    mutationFn: (nextMuted: boolean) => client.setThreadSubscription({ subject, muted: nextMuted }),
    onSuccess: invalidate,
    onError: toastMutationError("comments.subscription"),
  });

  const lock = useMutation({
    mutationFn: (nextLocked: boolean) => client.lockThread({ subject, locked: nextLocked }),
    onSuccess: invalidate,
    onError: toastMutationError("comments.lock"),
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
              tooltip={muted ? "Turn thread notifications back on" : "Mute this thread"}
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
              tooltip={locked ? "Unlock this thread" : "Lock this thread"}
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
      ) : !viewerId && commentingEnabled && signInPrompt && roots.length > 0 ? (
        <SignInToComment prompt={signInPrompt} />
      ) : null}

      {isLoading ? (
        <CommentThreadSkeleton />
      ) : roots.length === 0 ? (
        (renderEmpty?.({ signedIn: viewerId !== null }) ?? (
          <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
            <MicroLabel>{emptyLabel}</MicroLabel>
            <Text size="xs" variant="muted">
              {emptyHint}
            </Text>
          </Well>
        ))
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
              focusId={focusRootId === root.id ? focusId : null}
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

  const withExtras = extras ? (
    <CommentExtrasContext.Provider value={extras}>{content}</CommentExtrasContext.Provider>
  ) : (
    content
  );
  const gated = gate ? (
    <CommentGateContext.Provider value={gate}>{withExtras}</CommentGateContext.Provider>
  ) : (
    withExtras
  );
  return shell ? shell(gated, commentCount) : gated;
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

function SignInToComment({ prompt }: { prompt: string }) {
  return (
    <Well
      variant="ghost"
      className="flex-row flex-wrap items-center justify-between gap-3 p-4 backdrop-blur-none"
    >
      <Text size="sm" variant="muted">
        {prompt}
      </Text>
      <Button
        size="sm"
        onClick={() => signInWithDiscord("profile_wall")}
        className="tracking-widest"
      >
        LOGIN
      </Button>
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
  const self = useStore(activeUserStore, (s) => s.profile);
  const viewer = useMemberViewer();
  const gate = useContext(CommentGateContext);

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
          withOptimisticComment(previous, optimisticComment(user, self, viewer, parent, body)),
        );
      }
      const draft = content;
      setContent("");
      onCancel?.();
      return { previous, draft };
    },
    onError: (err: Error, body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(queryKey, ctx.previous);
      if (ctx) setContent(ctx.draft);
      if (gate?.onServerRefusal(err, () => post.mutate(body))) return;
      reportMutationError(err, "comments.create");
      toast.error(err.message);
    },
    onSuccess: () => onPosted(),
  });

  const remaining = maxLength - content.length;
  const canPost = Boolean(content.trim()) && !post.isPending;
  const submit = () => {
    if (!canPost) return;
    const body = content.trim();
    if (gate) gate.guard(() => post.mutate(body));
    else post.mutate(body);
  };

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (!isMultilineSubmitKey(e)) return;
          e.preventDefault();
          submit();
        }}
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
          <Button size="sm" onClick={submit} disabled={!canPost} className="tracking-widest">
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
  focusId,
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
  /** The deep-linked comment, when this is the chain that holds it. */
  focusId?: number | null;
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

  // A deep-linked reply can sit past the preview cap, or past the reply
  // cap the page query itself stopped at. Lifting the cap — and fetching
  // the rest when the row isn't here — is what puts the anchor in the
  // document for `CommentItem` to scroll to.
  const focusMissing =
    focusId != null && focusId !== root.id && !known.some((c) => c.id === focusId);
  useEffect(() => {
    if (focusId == null || focusId === root.id) return;
    setExpanded(true);
    // `loadRest` is rebuilt every render, so the flags it reads stand in
    // for it in the dep list.
    if (focusMissing && canFetchMore && !loadingMore) void loadRest();
  }, [focusId, root.id, focusMissing, canFetchMore, loadingMore]);

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
        focused={focusId === root.id}
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
            focused={focusId === reply.id}
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
  focused = false,
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
  /** This is the comment a `#comment-<id>` link asked for. */
  focused?: boolean;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const extras = useContext(CommentExtrasContext);
  useEffect(() => {
    if (!focused) return;
    rowRef.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const edit = useMutation({
    mutationFn: () => client.editComment({ commentId: comment.id, content: editDraft.trim() }),
    onSuccess: () => {
      setEditing(false);
      onChange();
    },
    onError: toastMutationError("comments.update"),
  });

  const remove = useMutation({
    mutationFn: () => client.deleteComment({ commentId: comment.id }),
    onSuccess: onChange,
    onError: toastMutationError("comments.delete"),
  });

  const report = useMutation({
    mutationFn: (reason: string) => client.reportComment({ commentId: comment.id, reason }),
    onSuccess: () => toast.success("Report sent — staff will take a look."),
    onError: toastMutationError("comments.report"),
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
  const authorGlow = comment.author
    ? resolveNameGlow({
        nameGlowColors: comment.author.nameGlowColors,
        isBooster: comment.author.isBooster,
        guildRoles: comment.author.guildRoles,
      })
    : null;

  return (
    <div
      id={`comment-${comment.id}`}
      ref={rowRef}
      className={cn(
        "relative flex flex-col gap-2 px-4 py-3",
        // Stays lit rather than fading out: the reader came here from a
        // notification, and the mark is what says which note it meant.
        focused && "bg-primary/10 ring-1 ring-primary/40 ring-inset",
      )}
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
        <UserAvatar
          avatarUrl={comment.author?.avatarUrl ?? null}
          guildAvatarUrl={comment.author?.guildAvatarUrl ?? null}
          username={authorName}
          size={24}
        />
        {comment.author ? (
          <RouterLink
            to="/profile/$userId"
            params={profileLinkParams({ id: comment.author.id, urlStub: comment.author.urlStub })}
            className={cn(
              "font-mono text-[10px] tracking-widest uppercase transition-colors hover:text-primary",
              nameGlowProps(authorGlow, comment.author.nameGlowMotion).className,
            )}
            style={nameGlowProps(authorGlow, comment.author.nameGlowMotion).style}
          >
            {authorName}
          </RouterLink>
        ) : (
          <MicroLabel as="span">{authorName}</MicroLabel>
        )}
        <RankBadge roles={comment.author?.guildRoles} />
        {comment.byAuthor ? (
          <Badge variant="secondary" size="label">
            AUTHOR
          </Badge>
        ) : null}
        {extras.badges?.(comment)}
        {flattenedParentName ? (
          <MicroLabel as="span" className="text-primary/70">
            → @{flattenedParentName}
          </MicroLabel>
        ) : null}
        <MicroLabel as="span" className="ml-auto shrink-0">
          {<TimeAgo date={comment.createdAt} />}
          {comment.editedAt ? " · EDITED" : ""}
        </MicroLabel>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            onKeyDown={(e) => {
              if (!isMultilineSubmitKey(e)) return;
              e.preventDefault();
              if (editDraft.trim() && !edit.isPending) edit.mutate();
            }}
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
          {extras.renderContent && comment.content ? (
            extras.renderContent(comment.content)
          ) : (
            <Censored>{comment.content}</Censored>
          )}
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
          {extras.actions?.(comment)}
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

export function CommentAction({
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
