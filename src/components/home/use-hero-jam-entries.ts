import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { JAM_STALE_MS } from "@/components/jams/JamCalendarPage/use-jam-data";
import { orpc } from "@/orpc/client";

/** The server's ceiling, not the jam page's grid default — fewer round
 * trips per flick of the scroller. */
const PAGE_SIZE = 96;

/** Every submission to the hero's jam, paged in behind the scroll: the
 * shared `listRecentEntries` sample caps at ten covers per jam, so once
 * the view opens this pulls the full feed instead. */
export function useHeroJamEntries(
  jamId: number,
  enabled: boolean,
  sortBy: "recent" | "ratings" = "recent",
) {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    ...orpc.listJamEntries.infiniteOptions({
      input: (page: number) => ({ jamId, page, pageSize: PAGE_SIZE, sortBy }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, pages) => {
        const loaded = pages.reduce((n, p) => n + p.entries.length, 0);
        // An empty page also ends it: `total` can drift while paging.
        return lastPage.entries.length > 0 && loaded < lastPage.total ? pages.length : undefined;
      },
    }),
    enabled,
    staleTime: JAM_STALE_MS,
  });

  const entries = useMemo(() => (data?.pages ?? []).flatMap((page) => page.entries), [data]);

  const fetchMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return { entries, fetchMore };
}
