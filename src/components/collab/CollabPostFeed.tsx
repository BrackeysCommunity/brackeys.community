import { useStore } from "@tanstack/react-store";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { VirtualGrid } from "@/components/ui/virtual-grid";
import { Well } from "@/components/ui/well";
import { collabStore } from "@/lib/collab-store";
import { cn } from "@/lib/utils";

import {
  CLEARED_COLLAB_FILTERS,
  countActiveCollabFilters,
  useCollabBoardSearch,
} from "./collab-filters";
import { CollabPostCard, CollabPostGridCard } from "./CollabPostCard";
import { type CollabListingItem, useCollabListing } from "./use-collab-listing";

interface CollabPostFeedProps {
  /** Currently authenticated user id — drives owner-specific UI. */
  currentUserId?: string | null;
  /** Post currently loaded in the inspector, if any. */
  selectedPostId?: number | null;
  /** Load a post into the inspector (desktop) or popover (mobile). */
  onSelectPost: (postId: number) => void;
}

/** Rough mounted height of one row in each layout, until measured. */
const CARD_ROW_ESTIMATE = 264;
const LIST_ROW_ESTIMATE = 86;

/**
 * The list lane. Renders the board's posts in whichever layout the
 * `layout` toggle selects and pages in more as the bottom sentinel
 * scrolls into view.
 *
 * Virtualized through `VirtualGrid`, which does own the offset tracking
 * inside the app's scroll root: the page size is 20 but the lane never
 * drops what it has paged in, so a few minutes of scrolling leaves
 * hundreds of post cards — each with its own art — mounted behind you.
 * The paging sentinel rides in the footer so it stays mounted.
 */
export function CollabPostFeed({
  currentUserId,
  selectedPostId,
  onSelectPost,
}: CollabPostFeedProps) {
  const { search } = useCollabBoardSearch();
  const layout = useStore(collabStore, (s) => s.layout);
  const { items, isLoading, hasNextPage, isFetchingNext, fetchNext } =
    useCollabListing(currentUserId);

  const isCards = layout === "cards";

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNext) fetchNext();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNext, fetchNext]);

  if (isLoading) return <FeedSkeleton cards={isCards} />;
  if (items.length === 0) {
    return <FeedEmptyState filtered={countActiveCollabFilters(search) > 0} />;
  }

  return (
    <VirtualGrid
      items={items}
      getItemKey={(item) => `post-${item.post.id}`}
      renderItem={(item) => {
        const Card = isCards ? CollabPostGridCard : CollabPostCard;
        return (
          <Card
            post={item.post}
            pinned={item.pinned}
            selected={item.post.id === selectedPostId}
            onSelect={onSelectPost}
          />
        );
      }}
      // Cards are art-led tiles on the same column rhythm as the team
      // directory; the list is one row per post, full width, so a scan
      // reads straight down instead of snaking across columns.
      rowClassName={cn(
        "gap-3",
        isCards
          ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          : "flex flex-col gap-2",
      )}
      estimateRowHeight={isCards ? CARD_ROW_ESTIMATE : LIST_ROW_ESTIMATE}
      footer={
        hasNextPage ? (
          <div ref={sentinelRef} className="py-4">
            {isFetchingNext ? <FeedSkeleton cards={isCards} count={isCards ? 4 : 3} /> : null}
          </div>
        ) : null
      }
    />
  );
}

/**
 * The lane as the server document ships it: the first page of posts as a
 * plain grid of card tiles, every one a real anchor. The board proper
 * waits for hydration — `useIsSplitView` can't know the viewport on the
 * server — but the *content* must not, or a crawler reads an empty shell
 * despite the loader's prefetch. No virtualization (the page is at the
 * top, and the first page is all there is to mount) and no toolbar: this
 * renders exactly what a reader without JavaScript can use.
 */
export function CollabPostFeedStatic({
  items,
  onSelectPost,
}: {
  items: CollabListingItem[];
  onSelectPost: (postId: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {items.map((item) => (
        <CollabPostGridCard
          key={item.post.id}
          post={item.post}
          pinned={item.pinned}
          onSelect={onSelectPost}
        />
      ))}
    </div>
  );
}

/**
 * An empty board and an over-filtered board are different problems, so
 * they get different exits: one offers a way out of the filters, the
 * other just says the board is quiet.
 */
function FeedEmptyState({ filtered }: { filtered: boolean }) {
  const { setSearch } = useCollabBoardSearch();
  return (
    <Well className="items-center justify-center gap-3 px-4 py-12 text-center">
      <Text variant="muted" className="text-4xl opacity-40">
        [ ]
      </Text>
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        {filtered ? "No results match your filters" : "The board is empty — post the first role"}
      </Text>
      {filtered ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSearch(CLEARED_COLLAB_FILTERS)}
          className="tracking-widest"
        >
          CLEAR ALL FILTERS
        </Button>
      ) : null}
    </Well>
  );
}

function FeedSkeleton({ cards, count = 6 }: { cards: boolean; count?: number }) {
  return (
    <div
      className={cn(
        "gap-3",
        cards
          ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
          : "flex flex-col gap-2",
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("w-full", cards ? "h-[264px]" : "h-[86px]")} />
      ))}
    </div>
  );
}
