import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { type StackOverlap, viewerStackOverlap } from "@/lib/stack-overlap";
import { client, orpc } from "@/orpc/client";

import { collabFacetInput, sortPreset, useCollabBoardSearch } from "./collab-filters";

const PAGE_SIZE = 20;

type PostsPage = Awaited<ReturnType<typeof client.listPosts>>;

export type CollabListingItem = {
  post: PostsPage["posts"][number] & { viewerOverlap: StackOverlap | null };
  pinned: boolean;
};

/**
 * The board's listing query, shared by the lane that renders it and the
 * page that drives keyboard selection over it. Both call this hook;
 * react-query dedupes on the key so it stays one request.
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
  const filterInput = collabFacetInput(search);
  const { by: sortBy, order: sortOrder } = sortPreset(search.sort);

  // One request per session, not per page of posts — skills change about
  // as often as someone edits their profile.
  const viewerSkillsQuery = useQuery({
    ...orpc.getMySkillIds.queryOptions({ input: {} }),
    enabled: Boolean(currentUserId),
    staleTime: 5 * 60 * 1000,
  });

  const postsQuery = useInfiniteQuery({
    queryKey: ["listPosts", filterInput, sortBy, sortOrder],
    queryFn: ({ pageParam = 0 }) =>
      client.listPosts({
        ...filterInput,
        sortBy,
        sortOrder,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE;
      return fetched >= (lastPage.total ?? 0) ? undefined : fetched;
    },
    staleTime: 15 * 1000,
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

  /** Selection order for keyboard navigation. */
  const postIds = useMemo(() => items.map((item) => item.post.id), [items]);

  return {
    items,
    postIds,
    isLoading: postsQuery.isLoading,
    hasNextPage: postsQuery.hasNextPage,
    isFetchingNext: postsQuery.isFetchingNextPage,
    fetchNext: postsQuery.fetchNextPage,
  };
}
