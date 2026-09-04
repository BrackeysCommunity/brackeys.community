import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useSearchPerformed } from "@/lib/hooks/use-search-performed";
import { offsetInfiniteQueryOptions } from "@/lib/offset-infinite-query";
import { type StackOverlap, viewerStackOverlap } from "@/lib/stack-overlap";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import {
  type CollabListingDeps,
  collabFilterKinds,
  collabListingDeps,
  useCollabBoardSearch,
} from "./collab-filters";

const PAGE_SIZE = 20;

type PostsPage = Awaited<ReturnType<typeof client.listPosts>>;

export type CollabListingItem = {
  post: PostsPage["posts"][number] & { viewerOverlap: StackOverlap | null };
  pinned: boolean;
};

/**
 * The board's first page of posts, keyed on the URL. Shared with
 * `/collab`'s loader so a server prefetch lands on the entry this hook
 * reads instead of a neighbouring one.
 */
export function collabPostsQueryOptions({ filters, sortBy, sortOrder }: CollabListingDeps) {
  return offsetInfiniteQueryOptions({
    queryKey: ["listPosts", filters, sortBy, sortOrder],
    pageSize: PAGE_SIZE,
    fetchPage: (offset) =>
      client.listPosts({ ...filters, sortBy, sortOrder, limit: PAGE_SIZE, offset }),
    staleTime: STALE.board,
  });
}

/**
 * The board's listing query, shared by the lane that renders it and the
 * page's pre-hydration static feed. Both call this hook; react-query
 * dedupes on the key so it stays one request.
 *
 * Posts authored by the current viewer are hoisted to the top — they
 * render first regardless of sort, keeping server ordering within each
 * bucket so nothing else reshuffles.
 *
 * The "you match 3/5" badge is computed here rather than served: the
 * listing itself is anonymous and edge-cached, so the one viewer-dependent
 * part is a single private read of the viewer's own skill ids, intersected
 * against each post's stack in the browser.
 */
export function useCollabListing(currentUserId?: string | null) {
  const { search } = useCollabBoardSearch();

  // One request per session, not per page of posts — skills change about
  // as often as someone edits their profile.
  const viewerSkillsQuery = useQuery({
    ...orpc.getMySkillIds.queryOptions({ input: {} }),
    enabled: Boolean(currentUserId),
    staleTime: STALE.taxonomy,
  });

  const postsQuery = useInfiniteQuery(collabPostsQueryOptions(collabListingDeps(search)));

  useSearchPerformed({
    surface: "collab",
    query: search.q,
    filterKinds: collabFilterKinds(search),
    resultCount: postsQuery.isLoading ? null : (postsQuery.data?.pages[0]?.total ?? 0),
  });

  const allPosts = useMemo(
    () => postsQuery.data?.pages.flatMap((p) => p.posts) ?? [],
    [postsQuery.data],
  );

  const viewerSkillIds = useMemo(
    () => (viewerSkillsQuery.data ? new Set(viewerSkillsQuery.data) : undefined),
    [viewerSkillsQuery.data],
  );

  const items: CollabListingItem[] = useMemo(() => {
    const withOverlap = (post: PostsPage["posts"][number]) => ({
      ...post,
      viewerOverlap: viewerStackOverlap({
        stack: post.skills,
        viewerSkillIds,
        authorId: post.authorId,
        viewerId: currentUserId,
      }),
    });

    if (!currentUserId) {
      return allPosts.map((post) => ({ post: withOverlap(post), pinned: false }));
    }
    const mine: CollabListingItem[] = [];
    const others: CollabListingItem[] = [];
    for (const post of allPosts) {
      const pinned = post.authorId === currentUserId;
      (pinned ? mine : others).push({ post: withOverlap(post), pinned });
    }
    return [...mine, ...others];
  }, [allPosts, currentUserId, viewerSkillIds]);

  return {
    items,
    isLoading: postsQuery.isLoading,
    hasNextPage: postsQuery.hasNextPage,
    isFetchingNext: postsQuery.isFetchingNextPage,
    fetchNext: postsQuery.fetchNextPage,
  };
}
