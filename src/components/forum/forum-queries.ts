import {
  type InfiniteData,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import type { ForumPostKind } from "@/db/schema";
import { authStore } from "@/lib/auth-store";
import { toastMutationError } from "@/lib/mutation-errors";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { useGuildGate } from "./guild-gate";

export type ForumSort = "latest" | "top" | "hot" | "following";
export type ForumWindow = "day" | "week" | "month" | "all";

export type ForumFeedFilters = {
  sort?: ForumSort;
  window?: ForumWindow;
  kind?: ForumPostKind;
  category?: string;
  tag?: string;
  teamId?: string;
  authorId?: string;
};

export type ForumFeedPage = Awaited<ReturnType<typeof client.listForumPosts>>;
export type ForumCard = ForumFeedPage["posts"][number];
export type ForumPostDetail = NonNullable<Awaited<ReturnType<typeof client.getForumPost>>>;
export type ForumCategory = Awaited<ReturnType<typeof client.listForumCategories>>[number];
export type ForumFollowTarget = "team" | "user" | "tag" | "category" | "series";
export type ForumFollows = Awaited<ReturnType<typeof client.listMyForumFollows>>;

const PAGE_SIZE = 20;

/**
 * One feed, keyed on its filters. Not prefetched on the server: every card
 * carries the viewer's own like and save, and a loader prefetch would put
 * one viewer's marks into a document.
 */
export function forumFeedQueryOptions(filters: ForumFeedFilters) {
  return {
    ...orpc.listForumPosts.infiniteOptions({
      input: (cursor: string | undefined) => ({ ...filters, cursor, limit: PAGE_SIZE }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: ForumFeedPage) => last.nextCursor ?? undefined,
    }),
    staleTime: STALE.board,
  };
}

export function forumCategoriesQueryOptions() {
  return { ...orpc.listForumCategories.queryOptions(), staleTime: STALE.taxonomy };
}

export function forumSeriesQueryOptions(seriesId: number) {
  return { ...orpc.getForumSeries.queryOptions({ input: { seriesId } }), staleTime: STALE.viewer };
}

export function forumSearchQueryOptions(query: string, kind?: ForumPostKind) {
  return {
    ...orpc.searchForumPosts.infiniteOptions({
      input: (cursor: string | undefined) => ({ query, kind, cursor, limit: PAGE_SIZE }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: Awaited<ReturnType<typeof client.searchForumPosts>>) =>
        last.nextCursor ?? undefined,
    }),
    staleTime: STALE.listing,
  };
}

export function forumPostQueryOptions(postId: number) {
  return { ...orpc.getForumPost.queryOptions({ input: { postId } }), staleTime: STALE.viewer };
}

/** After a create, edit or delete: every feed and the post's own page. */
export function invalidateForum(queryClient: QueryClient, postId?: number) {
  void queryClient.invalidateQueries({ queryKey: orpc.listForumPosts.key() });
  if (postId != null) {
    void queryClient.invalidateQueries({ queryKey: orpc.getForumPost.key({ input: { postId } }) });
  }
}

type CardPatch = { likeCount?: number; viewer: Partial<ForumCard["viewer"]> };

function patchCard<T extends { id: number; likeCount: number; viewer: object }>(
  card: T,
  postId: number,
  patch: CardPatch,
): T {
  if (card.id !== postId) return card;
  return {
    ...card,
    likeCount: patch.likeCount ?? card.likeCount,
    viewer: { ...card.viewer, ...patch.viewer },
  };
}

/**
 * Writes a like or save into every cached copy of the post — each feed it
 * appears in and its page — so the count moves everywhere at once without
 * refetching whole feeds.
 */
function patchPostEverywhere(queryClient: QueryClient, postId: number, patch: CardPatch) {
  const patchPage = (page: ForumFeedPage): ForumFeedPage => ({
    ...page,
    pinned: page.pinned.map((c) => patchCard(c, postId, patch)),
    posts: page.posts.map((c) => patchCard(c, postId, patch)),
  });
  // Feeds are infinite; the side rails read single pages under the same key.
  queryClient.setQueriesData<InfiniteData<ForumFeedPage> | ForumFeedPage>(
    { queryKey: orpc.listForumPosts.key() },
    (data) => {
      if (!data) return data;
      if ("pages" in data) return { ...data, pages: data.pages.map(patchPage) };
      return patchPage(data);
    },
  );
  queryClient.setQueryData<ForumPostDetail | null>(
    orpc.getForumPost.queryKey({ input: { postId } }),
    (post) => (post ? patchCard(post, postId, patch) : post),
  );
}

/** Like and save, optimistic, behind the guild gate. */
export function useForumReactions(post: {
  id: number;
  likeCount: number;
  viewer: { liked: boolean; saved: boolean };
}) {
  const queryClient = useQueryClient();
  const { guard, onServerRefusal } = useGuildGate();

  const like = useMutation({
    mutationFn: (liked: boolean) => client.setForumReaction({ postId: post.id, liked }),
    onMutate: (liked) => {
      const before = { likeCount: post.likeCount, viewer: { liked: post.viewer.liked } };
      patchPostEverywhere(queryClient, post.id, {
        likeCount: Math.max(0, post.likeCount + (liked ? 1 : -1)),
        viewer: { liked },
      });
      return before;
    },
    onSuccess: (result) =>
      patchPostEverywhere(queryClient, post.id, {
        likeCount: result.likeCount,
        viewer: { liked: result.liked },
      }),
    onError: (error, liked, before) => {
      if (before) patchPostEverywhere(queryClient, post.id, before);
      if (onServerRefusal(error, "like", () => like.mutate(liked))) return;
      toastMutationError("forum.like")(error);
    },
  });

  const save = useMutation({
    mutationFn: (saved: boolean) => client.setForumBookmark({ postId: post.id, saved }),
    onMutate: (saved) => {
      patchPostEverywhere(queryClient, post.id, { viewer: { saved } });
      return { saved: post.viewer.saved };
    },
    onError: (error, saved, before) => {
      if (before) patchPostEverywhere(queryClient, post.id, { viewer: before });
      if (onServerRefusal(error, "save", () => save.mutate(saved))) return;
      toastMutationError("forum.save")(error);
    },
  });

  return {
    toggleLike: () => guard("like", () => like.mutate(!post.viewer.liked)),
    toggleSave: () => guard("save", () => save.mutate(!post.viewer.saved)),
  };
}

/** Everything the viewer follows; empty and idle while signed out. */
export function useForumFollows() {
  const { session } = useStore(authStore);
  return useQuery({
    ...orpc.listMyForumFollows.queryOptions(),
    enabled: Boolean(session?.user),
    staleTime: STALE.viewer,
  });
}

function isFollowing(
  follows: ForumFollows | undefined,
  type: ForumFollowTarget,
  target: string,
): boolean {
  if (!follows) return false;
  switch (type) {
    case "team":
      return follows.teams.some((t) => t.id === target);
    case "user":
      return follows.users.some((u) => u.id === target);
    case "tag":
      return follows.tags.includes(target);
    case "category":
      return follows.categories.some((c) => c.slug === target);
    case "series":
      return follows.series.some((s) => String(s.id) === target);
  }
}

/**
 * One Follow button's state and toggle. Targets are named the way their
 * pages name them — tags and categories by slug, the rest by id.
 */
export function useForumFollow(type: ForumFollowTarget, target: string) {
  const queryClient = useQueryClient();
  const { guard, onServerRefusal } = useGuildGate();
  const { data } = useForumFollows();
  const following = isFollowing(data, type, target);

  const mutation = useMutation({
    mutationFn: (next: boolean) =>
      client.setForumFollow({ targetType: type, target, following: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orpc.listMyForumFollows.key() });
      void queryClient.invalidateQueries({
        queryKey: orpc.listForumPosts.key({ input: { sort: "following" } }),
      });
    },
    onError: (error, next) => {
      if (onServerRefusal(error, "follow", () => mutation.mutate(next))) return;
      toastMutationError("forum.follow")(error);
    },
  });

  const pendingValue = mutation.isPending ? mutation.variables : undefined;
  return {
    following: pendingValue ?? following,
    pending: mutation.isPending,
    toggle: () => guard("follow", () => mutation.mutate(!following)),
  };
}
