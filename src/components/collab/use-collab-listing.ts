import { useInfiniteQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useMemo } from "react";

import { collabFilterInput, collabPeopleFilterInput, collabStore } from "@/lib/collab-store";
import { client } from "@/orpc/client";

const PAGE_SIZE = 20;

type PostsPage = Awaited<ReturnType<typeof client.listPosts>>;
type UsersPage = Awaited<ReturnType<typeof client.listAvailableUsers>>;

export type CollabListingItem =
  | { kind: "post"; post: PostsPage["posts"][number]; pinned: boolean }
  | { kind: "user"; user: UsersPage["users"][number] };

/**
 * The board's listing query, shared by the lane that renders it and the
 * page that drives keyboard selection over it. Both call this hook;
 * react-query dedupes on the key so it stays one request.
 *
 * Posts authored by the current viewer are hoisted to the top — they
 * render first regardless of sort, keeping server ordering within each
 * bucket so nothing else reshuffles.
 */
export function useCollabListing(currentUserId?: string | null) {
  const filters = useStore(collabStore, (s) => s.filters);
  const isPeople = filters.listingType === "people";
  const filterInput = collabFilterInput(filters);
  const peopleInput = collabPeopleFilterInput(filters);

  const postsQuery = useInfiniteQuery({
    queryKey: ["listPosts", filterInput, filters.sortBy, filters.sortOrder],
    queryFn: ({ pageParam = 0 }) =>
      client.listPosts({
        ...filterInput,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE;
      return fetched >= (lastPage.total ?? 0) ? undefined : fetched;
    },
    staleTime: 15 * 1000,
    enabled: !isPeople,
  });

  const usersQuery = useInfiniteQuery({
    queryKey: ["listAvailableUsers", peopleInput, filters.sortBy, filters.sortOrder],
    queryFn: ({ pageParam = 0 }) =>
      client.listAvailableUsers({
        ...peopleInput,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE;
      return fetched >= (lastPage.total ?? 0) ? undefined : fetched;
    },
    staleTime: 15 * 1000,
    enabled: isPeople,
  });

  const allPosts = useMemo(
    () => postsQuery.data?.pages.flatMap((p) => p.posts) ?? [],
    [postsQuery.data],
  );
  const allUsers = useMemo(
    () => usersQuery.data?.pages.flatMap((p) => p.users) ?? [],
    [usersQuery.data],
  );

  const items: CollabListingItem[] = useMemo(() => {
    if (isPeople) return allUsers.map((user) => ({ kind: "user" as const, user }));
    if (!currentUserId) {
      return allPosts.map((post) => ({ kind: "post" as const, post, pinned: false }));
    }
    const mine: CollabListingItem[] = [];
    const others: CollabListingItem[] = [];
    for (const post of allPosts) {
      (post.authorId === currentUserId ? mine : others).push({
        kind: "post",
        post,
        pinned: post.authorId === currentUserId,
      });
    }
    return [...mine, ...others];
  }, [allPosts, allUsers, isPeople, currentUserId]);

  /** Selection order for keyboard navigation. Empty in people mode. */
  const postIds = useMemo(
    () => items.flatMap((item) => (item.kind === "post" ? [item.post.id] : [])),
    [items],
  );

  return {
    items,
    postIds,
    isPeople,
    isLoading: isPeople ? usersQuery.isLoading : postsQuery.isLoading,
    hasNextPage: isPeople ? usersQuery.hasNextPage : postsQuery.hasNextPage,
    isFetchingNext: isPeople ? usersQuery.isFetchingNextPage : postsQuery.isFetchingNextPage,
    fetchNext: isPeople ? usersQuery.fetchNextPage : postsQuery.fetchNextPage,
  };
}
