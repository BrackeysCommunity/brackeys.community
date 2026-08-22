import { infiniteQueryOptions } from "@tanstack/react-query";

/**
 * Offset-paged `infiniteQueryOptions` for listings whose pages carry a
 * `total`: the next offset is how many rows the loaded pages cover, and
 * paging stops once that reaches the total. The three discovery listings
 * (collab, members, teams) all page this way — spelled once so their
 * boundary arithmetic can't drift.
 */
export function offsetInfiniteQueryOptions<Page extends { total?: number | null }>(opts: {
  queryKey: readonly unknown[];
  pageSize: number;
  fetchPage: (offset: number) => Promise<Page>;
  staleTime: number;
}) {
  const { queryKey, pageSize, fetchPage, staleTime } = opts;
  // Callers key on the inputs their fetchPage closes over; the closure
  // itself can't be serialized into the key.
  // eslint-disable-next-line eslint-tanstack-query/exhaustive-deps
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage: Page, allPages: Page[]) => {
      const fetched = allPages.length * pageSize;
      return fetched >= (lastPage.total ?? 0) ? undefined : fetched;
    },
    staleTime,
  });
}
