import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { useInfiniteScrollSentinel } from "@/lib/hooks/use-infinite-scroll-sentinel";

import { type ForumFeedFilters, type ForumWindow, forumFeedQueryOptions } from "./forum-queries";
import type { ForumFeedSearch } from "./forum-search";
import { ForumPostCard } from "./ForumPostCard";

const KIND_FILTERS = [
  { value: "all", label: "ALL" },
  { value: "devlog", label: "DEVLOGS" },
  { value: "post", label: "POSTS" },
  { value: "question", label: "QUESTIONS" },
] as const;

const WINDOW_LABEL: Record<ForumWindow, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

/** Writes one change into the current route's search, keeping the rest. */
export function useFeedSearchUpdate() {
  const navigate = useNavigate();
  return (patch: Partial<ForumFeedSearch>) =>
    void navigate({
      to: ".",
      search: (prev: ForumFeedSearch) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
}

/** Kind and sort: the filter row above every feed. */
export function FeedControls({
  search,
  hideKind = false,
}: {
  search: ForumFeedSearch;
  hideKind?: boolean;
}) {
  const update = useFeedSearchUpdate();
  const sort = search.sort ?? "latest";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      {hideKind ? (
        <span />
      ) : (
        <SegmentedControl
          size="sm"
          value={search.kind ?? "all"}
          onChange={(value) =>
            update({ kind: value === "all" ? undefined : (value as ForumFeedSearch["kind"]) })
          }
          aria-label="Filter by kind"
          className="no-scrollbar max-w-full overflow-x-auto"
        >
          {KIND_FILTERS.map((filter) => (
            <SegmentedControl.Item
              key={filter.value}
              value={filter.value}
              className="tracking-widest"
            >
              {filter.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      )}
      <div className="flex items-center gap-2">
        {sort === "top" ? (
          <Select
            value={search.window ?? "week"}
            onValueChange={(value) => update({ window: value as ForumWindow })}
          >
            <SelectTrigger size="sm" aria-label="Time window" className="h-7 w-32">
              <SelectValue>{WINDOW_LABEL[search.window ?? "week"]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WINDOW_LABEL) as ForumWindow[]).map((window) => (
                <SelectItem key={window} value={window}>
                  {WINDOW_LABEL[window]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <SegmentedControl
          size="sm"
          value={sort}
          onChange={(value) =>
            update({
              sort: value === "top" ? "top" : undefined,
              window: undefined,
            })
          }
          aria-label="Sort"
        >
          <SegmentedControl.Item value="latest" className="tracking-widest">
            LATEST
          </SegmentedControl.Item>
          <SegmentedControl.Item value="top" className="tracking-widest">
            TOP
          </SegmentedControl.Item>
        </SegmentedControl>
      </div>
    </div>
  );
}

/** The narrowing a rail link or tag chip put on the feed, each removable. */
export function ActiveFilterChips({
  search,
  teamName,
}: {
  search: ForumFeedSearch;
  teamName?: string | null;
}) {
  const update = useFeedSearchUpdate();
  const chips = [
    search.tag ? { label: `#${search.tag}`, clear: { tag: undefined } } : null,
    search.team ? { label: teamName ?? "One team", clear: { team: undefined } } : null,
  ].filter((chip) => chip !== null);
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MicroLabel as="span" className="uppercase">
        Filtered to
      </MicroLabel>
      {chips.map((chip) => (
        <Badge
          key={chip.label}
          variant="secondary"
          size="label"
          className="pointer-events-auto h-6 cursor-pointer uppercase"
          render={
            <button
              type="button"
              onClick={() => update(chip.clear)}
              aria-label={`Clear ${chip.label}`}
            />
          }
        >
          {chip.label}
          <HugeiconsIcon icon={Cancel01Icon} />
        </Badge>
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: 3 }, (_, i) => (
        <Well key={i} variant="ghost" className="gap-3 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-16" />
        </Well>
      ))}
    </div>
  );
}

/**
 * The stream: pins first, then pages as the foot scrolls into view. Plain
 * infinite scroll rather than a virtualized list — cards vary in height
 * by kind, which `VirtualGrid`'s fixed rows can't hold.
 */
export function ForumFeed({
  filters,
  showCategory = true,
  empty,
}: {
  filters: ForumFeedFilters;
  showCategory?: boolean;
  empty?: React.ReactNode;
}) {
  const query = useInfiniteQuery(forumFeedQueryOptions(filters));
  const { pinned, posts } = useMemo(() => {
    const pages = query.data?.pages ?? [];
    return {
      pinned: pages[0]?.pinned ?? [],
      posts: pages.flatMap((page) => page.posts),
    };
  }, [query.data]);

  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage: Boolean(query.hasNextPage),
    isFetching: query.isFetchingNextPage,
    fetchNext: query.fetchNextPage,
  });

  if (query.isLoading) return <FeedSkeleton />;
  if (query.isError) {
    return (
      <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
        <MicroLabel>COULDN&apos;T LOAD THE FEED</MicroLabel>
        <Text size="xs" variant="muted">
          Refresh to try again.
        </Text>
      </Well>
    );
  }
  if (pinned.length === 0 && posts.length === 0) {
    return (
      empty ?? (
        <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
          <MicroLabel>NOTHING HERE YET</MicroLabel>
          <Text size="xs" variant="muted">
            Be the first to post.
          </Text>
        </Well>
      )
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {[...pinned, ...posts].map((post) => (
        <ForumPostCard key={post.id} post={post} showCategory={showCategory} />
      ))}
      <div ref={sentinelRef} aria-hidden />
      {query.isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}
