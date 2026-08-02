import { useStore } from "@tanstack/react-store";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { collabStore, countActiveCollabFilters, resetCollabFilters } from "@/lib/collab-store";
import { cn } from "@/lib/utils";

import { CollabPostCard, CollabPostGridCard } from "./CollabPostCard";
import { CollabUserCard } from "./CollabUserCard";
import { useCollabListing } from "./use-collab-listing";

interface CollabPostFeedProps {
  /** Currently authenticated user id — drives owner-specific UI. */
  currentUserId?: string | null;
  /** Post currently loaded in the inspector, if any. */
  selectedPostId?: number | null;
  /** Load a post into the inspector (desktop) or popover (mobile). */
  onSelectPost: (postId: number) => void;
}

/**
 * The list lane. Renders whichever listing the `listingType` filter
 * selects and pages in more as the bottom sentinel scrolls into view.
 *
 * Not virtualized: cards are cheap, the page size is 20, and the lane
 * is a plain scroll container — a virtualizer here would have to track
 * its own offset inside an ancestor it doesn't own for no real gain.
 */
export function CollabPostFeed({
  currentUserId,
  selectedPostId,
  onSelectPost,
}: CollabPostFeedProps) {
  const filters = useStore(collabStore, (s) => s.filters);
  const layout = useStore(collabStore, (s) => s.layout);
  const { items, isPeople, isLoading, hasNextPage, isFetchingNext, fetchNext } =
    useCollabListing(currentUserId);

  // People are always tiles; the list/cards toggle only reshapes posts.
  const isCards = !isPeople && layout === "cards";

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
    return <FeedEmptyState filtered={countActiveCollabFilters(filters) > 0} isPeople={isPeople} />;
  }

  return (
    <div
      className={cn(
        "grid gap-3",
        // Tiles are art-led and stay legible small, so the card layout
        // takes more, narrower columns than the wide list rows.
        isCards
          ? "grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))]"
          : "grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3",
      )}
    >
      {items.map((item) =>
        item.kind === "post" ? (
          isCards ? (
            <CollabPostGridCard
              key={`post-${item.post.id}`}
              post={item.post}
              pinned={item.pinned}
              selected={item.post.id === selectedPostId}
              onSelect={onSelectPost}
            />
          ) : (
            <CollabPostCard
              key={`post-${item.post.id}`}
              post={item.post}
              pinned={item.pinned}
              selected={item.post.id === selectedPostId}
              onSelect={onSelectPost}
            />
          )
        ) : (
          <CollabUserCard key={`user-${item.user.id}`} user={item.user} skills={item.user.skills} />
        ),
      )}

      {hasNextPage ? (
        <div ref={sentinelRef} className="col-span-full flex justify-center py-4">
          {isFetchingNext ? (
            <Text
              monospace
              size="xs"
              variant="muted"
              className="animate-pulse tracking-widest uppercase"
            >
              Loading more…
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * An empty board and an over-filtered board are different problems, so
 * they get different exits: one offers a way out of the filters, the
 * other just says the board is quiet.
 */
function FeedEmptyState({ filtered, isPeople }: { filtered: boolean; isPeople: boolean }) {
  return (
    <Well className="items-center justify-center gap-3 px-4 py-12 text-center">
      <Text monospace variant="muted" className="text-4xl opacity-40">
        [ ]
      </Text>
      <Text monospace size="xs" variant="muted" className="tracking-widest uppercase">
        {filtered
          ? "No results match your filters"
          : isPeople
            ? "Nobody has marked themselves available yet"
            : "The board is empty — post the first role"}
      </Text>
      {filtered ? (
        <Button
          variant="outline"
          size="sm"
          onClick={resetCollabFilters}
          className="font-mono tracking-widest"
        >
          CLEAR ALL FILTERS
        </Button>
      ) : null}
    </Well>
  );
}

function FeedSkeleton({ cards }: { cards: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className={cn("w-full", cards ? "h-[248px]" : "h-[116px]")} />
      ))}
    </div>
  );
}
