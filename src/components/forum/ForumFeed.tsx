import { ArrowUp02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useSearchPerformed } from "@/lib/hooks/use-search-performed";

import {
  type ForumFeedFilters,
  type ForumSort,
  type ForumWindow,
  forumFeedQueryOptions,
  forumSearchQueryOptions,
} from "./forum-queries";
import type { ForumFeedSearch } from "./forum-search";
import { ForumPostCard, PulseRow } from "./ForumPostCard";
import { useForumLiveCount } from "./use-forum-live";

const KIND_FILTERS = [
  { value: "all", label: "ALL" },
  { value: "devlog", label: "DEVLOGS" },
  { value: "post", label: "POSTS" },
  { value: "question", label: "QUESTIONS" },
] as const;

const SORT_TABS: { value: ForumSort; label: string }[] = [
  { value: "hot", label: "FOR YOU" },
  { value: "following", label: "FOLLOWING" },
  { value: "latest", label: "LATEST" },
  { value: "top", label: "TOP" },
];

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

/** Kind and sort: the filter row above every feed. The personal tabs —
 *  For you and Following — belong to the main feed only. */
export function FeedControls({
  search,
  hideKind = false,
  personal = false,
}: {
  search: ForumFeedSearch;
  hideKind?: boolean;
  personal?: boolean;
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
              sort: value === "latest" ? undefined : (value as ForumSort),
              window: undefined,
            })
          }
          aria-label="Sort"
          className="no-scrollbar max-w-full overflow-x-auto"
        >
          {SORT_TABS.filter(
            (tab) => personal || (tab.value !== "hot" && tab.value !== "following"),
          ).map((tab) => (
            <SegmentedControl.Item key={tab.value} value={tab.value} className="tracking-widest">
              {tab.label}
            </SegmentedControl.Item>
          ))}
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
    search.author ? { label: "One member", clear: { author: undefined } } : null,
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
  compact = false,
  empty,
}: {
  filters: ForumFeedFilters;
  showCategory?: boolean;
  /** Pulse: short posts as a dense stream rather than cards. */
  compact?: boolean;
  empty?: React.ReactNode;
}) {
  const query = useInfiniteQuery(forumFeedQueryOptions(filters));
  const live = useForumLiveCount(filters);
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
      <>
        <NewPostsPill count={live.count} onShow={live.showNew} />
        {empty ?? (
          <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
            <MicroLabel>
              {filters.sort === "following" ? "NOTHING FROM WHAT YOU FOLLOW" : "NOTHING HERE YET"}
            </MicroLabel>
            <Text size="xs" variant="muted">
              {filters.sort === "following"
                ? "Follow teams, members, tags or categories and their posts land here."
                : "Be the first to post."}
            </Text>
          </Well>
        )}
      </>
    );
  }

  const all = [...pinned, ...posts];
  return (
    <div className="flex flex-col gap-4">
      <NewPostsPill count={live.count} onShow={live.showNew} />
      {compact ? (
        <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
          {all.map((post) => (
            <PulseRow key={post.id} post={post} />
          ))}
        </Well>
      ) : (
        all.map((post) => <ForumPostCard key={post.id} post={post} showCategory={showCategory} />)
      )}
      <div ref={sentinelRef} aria-hidden />
      {query.isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}

/** "N new posts": sticks to the top of the stream until pressed. */
function NewPostsPill({ count, onShow }: { count: number; onShow: () => void }) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none sticky top-3 z-20 flex justify-center">
      <Button size="sm" onClick={onShow} className="pointer-events-auto tracking-widest shadow-lg">
        <HugeiconsIcon icon={ArrowUp02Icon} />
        {count === 1 ? "1 NEW POST" : `${count} NEW POSTS`}
      </Button>
    </div>
  );
}

/** `?q=` on the forum: matching posts, best match first. */
export function ForumSearchResults({
  query,
  kind,
}: {
  query: string;
  kind?: ForumFeedFilters["kind"];
}) {
  const results = useInfiniteQuery(forumSearchQueryOptions(query, kind));
  const posts = useMemo(() => (results.data?.pages ?? []).flatMap((p) => p.posts), [results.data]);
  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage: Boolean(results.hasNextPage),
    isFetching: results.isFetchingNextPage,
    fetchNext: results.fetchNextPage,
  });
  useSearchPerformed({
    surface: "forum",
    query,
    filterKinds: kind ? ["kind"] : [],
    resultCount: results.isSuccess ? posts.length : null,
  });

  if (results.isLoading) return <FeedSkeleton />;
  if (posts.length === 0) {
    return (
      <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
        <MicroLabel>NO POSTS MATCH</MicroLabel>
        <Text size="xs" variant="muted">
          Try fewer words, or a tag.
        </Text>
      </Well>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {posts.map((post) => (
        <ForumPostCard key={post.id} post={post} />
      ))}
      <div ref={sentinelRef} aria-hidden />
      {results.isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}
