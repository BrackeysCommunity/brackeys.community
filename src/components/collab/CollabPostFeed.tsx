import { useInfiniteQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { collabStore, setCollabFilters, type CollabSortBy } from "@/lib/collab-store";
import { client } from "@/orpc/client";

import { CollabPostCard, CollabUserCard } from "./CollabPostCard";

const PAGE_SIZE = 20;

const SORT_OPTIONS: { value: CollabSortBy; label: string }[] = [
  { value: "createdAt", label: "RECENT" },
  { value: "updatedAt", label: "POPULAR" },
];

interface CollabPostFeedProps {
  /** Show the count + sort row above the list. */
  showHeader?: boolean;
  /** Currently authenticated user id — drives owner-specific UI
   *  (pinned cards, EDIT button instead of RESPOND). */
  currentUserId?: string | null;
  /** Open the post detail popover for the given id. */
  onOpenPost: (postId: number) => void;
}

/**
 * Virtualized post / people feed. Switches its data source based on the
 * `listingType` filter, paginates infinitely, and uses TanStack
 * Virtual's measureElement so cards self-size as they enter the view.
 *
 * Posts authored by the current viewer are pinned to the top of the
 * list — they always render first regardless of sort, with a small
 * "pinned · your post" ribbon so the user can see their own activity
 * at a glance.
 */
export function CollabPostFeed({
  showHeader = true,
  currentUserId,
  onOpenPost,
}: CollabPostFeedProps) {
  const { filters } = useStore(collabStore);
  const isPeople = filters.listingType === "people";

  const postsQuery = useInfiniteQuery({
    queryKey: ["listPosts", filters],
    queryFn: ({ pageParam = 0 }) =>
      client.listPosts({
        type: filters.type,
        status: filters.status,
        search: filters.search || undefined,
        experienceLevel: filters.experienceLevel,
        compensationType: filters.compensationType,
        isIndividual: filters.isIndividual,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE;
      if (fetched >= (lastPage.total ?? 0)) return undefined;
      return fetched;
    },
    staleTime: 15 * 1000,
    enabled: !isPeople,
  });

  const usersQuery = useInfiniteQuery({
    queryKey: ["listAvailableUsers", filters],
    queryFn: ({ pageParam = 0 }) =>
      client.listAvailableUsers({
        search: filters.search || undefined,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE;
      if (fetched >= (lastPage.total ?? 0)) return undefined;
      return fetched;
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
  const totalCount = isPeople
    ? (usersQuery.data?.pages[0]?.total ?? 0)
    : (postsQuery.data?.pages[0]?.total ?? 0);

  type Item =
    | { kind: "post"; post: (typeof allPosts)[number]; pinned: boolean }
    | { kind: "user"; user: (typeof allUsers)[number] };

  // Hoist the viewer's own posts to the top so they can find them
  // quickly. We preserve the server-side ordering within each bucket
  // (mine vs. everyone else's) to avoid re-shuffling unrelated posts.
  const items: Item[] = useMemo(() => {
    if (isPeople) return allUsers.map((user) => ({ kind: "user" as const, user }));
    if (!currentUserId) {
      return allPosts.map((post) => ({ kind: "post" as const, post, pinned: false }));
    }
    const mine: Item[] = [];
    const others: Item[] = [];
    for (const post of allPosts) {
      if (post.authorId === currentUserId) {
        mine.push({ kind: "post", post, pinned: true });
      } else {
        others.push({ kind: "post", post, pinned: false });
      }
    }
    return [...mine, ...others];
  }, [allPosts, allUsers, isPeople, currentUserId]);

  const isLoading = isPeople ? usersQuery.isLoading : postsQuery.isLoading;
  const hasNextPage = isPeople ? usersQuery.hasNextPage : postsQuery.hasNextPage;
  const isFetchingNext = isPeople ? usersQuery.isFetchingNextPage : postsQuery.isFetchingNextPage;
  const fetchNext = isPeople ? usersQuery.fetchNextPage : postsQuery.fetchNextPage;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 168,
    overscan: 5,
    gap: 12,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (last.index >= items.length - 1 && !isFetchingNext && hasNextPage) {
      fetchNext();
    }
  }, [virtualItems, items.length, hasNextPage, isFetchingNext, fetchNext]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {showHeader ? <FeedHeader count={items.length} total={totalCount} /> : null}
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-y-auto pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {isLoading ? (
          <FeedSkeleton />
        ) : items.length === 0 ? (
          <Well className="items-center justify-center gap-3 py-16">
            <Text monospace variant="muted" className="text-4xl opacity-40">
              [ ]
            </Text>
            <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
              No results match your filters
            </Text>
          </Well>
        ) : (
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualItems.map((virtualItem) => {
              const isLoader = virtualItem.index >= items.length;
              if (isLoader) {
                return (
                  <div
                    key="loader"
                    className="absolute top-0 left-0 flex w-full justify-center py-4"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <Text
                      monospace
                      size="xs"
                      variant="muted"
                      className="animate-pulse tracking-widest uppercase"
                    >
                      Loading more…
                    </Text>
                  </div>
                );
              }
              const item = items[virtualItem.index];
              const itemKey =
                item.kind === "post" ? `post-${item.post.id}` : `user-${item.user.id}`;
              return (
                <div
                  key={itemKey}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {item.kind === "post" ? (
                    <CollabPostCard
                      post={item.post}
                      currentUserId={currentUserId ?? null}
                      pinned={item.pinned}
                      onOpen={onOpenPost}
                    />
                  ) : (
                    <CollabUserCard user={item.user} skills={item.user.skills} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FeedHeader({ count, total }: { count: number; total: number }) {
  const { filters } = useStore(collabStore);
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2 font-mono">
        <Text
          as="span"
          monospace
          bold
          density="dense"
          className="text-2xl text-foreground tabular-nums"
        >
          {count}
        </Text>
        <Text as="span" monospace size="xs" variant="muted" className="tracking-widest">
          / {total} POSTS
        </Text>
      </div>
      <div className="flex items-center gap-2">
        <Text as="span" monospace size="xs" variant="muted" className="tracking-widest">
          SORT
        </Text>
        <SegmentedControl
          value={filters.sortBy}
          onChange={(v) => setCollabFilters({ sortBy: v as CollabSortBy })}
          size="sm"
        >
          {SORT_OPTIONS.map((o) => (
            <SegmentedControl.Item key={o.value} value={o.value}>
              <span className="font-mono tracking-widest">{o.label}</span>
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-32 w-full" />
      ))}
    </div>
  );
}
