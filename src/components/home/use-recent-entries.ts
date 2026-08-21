import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { JAM_STALE_MS } from "@/components/jams/JamCalendarPage/use-jam-data";
import { client } from "@/orpc/client";

export type RecentEntry = Awaited<
  ReturnType<typeof import("@/orpc/client").client.listRecentEntries>
>["entries"][number];

/** Covers shown per jam in a showcase row's strip. The strip scrolls, so
 * this is about how much of a jam's output is worth sampling, not about
 * how many tiles fit across. */
export const RECENT_ENTRIES_PER_JAM = 10;

/**
 * Every jam the landing page shows covers for: the hero rotation plus the
 * band. One helper so the `/` loader's prefetch and the page's query agree
 * on the set. Must stay within `RECENT_ENTRIES_MAX_JAMS` in
 * `@/orpc/router/jam`.
 */
export function entryJamIdsFor(
  heroJamIds: readonly number[],
  showcase: readonly { jamId: number }[],
): number[] {
  return [...heroJamIds, ...showcase.map((jam) => jam.jamId)];
}

/**
 * One request for the whole band rather than a query per row — the landing
 * page already ships the ~500-jam board payload and shouldn't add a round
 * trip per row on top of it. The key is the *sorted* id list so re-ordering
 * the rows (the hero jam is pulled out of the band, and which jam that is
 * changes as jams go live) reuses the cache entry instead of refetching.
 *
 * Exported because `/`'s loader prefetches this on the server: without it
 * the band can't even start fetching until the board query resolves in the
 * browser, which is two chained round trips after hydration on the
 * landing surface.
 */
export function recentEntriesQueryOptions(jamIds: number[], limit = RECENT_ENTRIES_PER_JAM) {
  const ids = [...new Set(jamIds)].sort((a, b) => a - b);
  return queryOptions({
    queryKey: ["recent-jam-entries", ids, limit],
    queryFn: () => client.listRecentEntries({ jamIds: ids, limit }),
    staleTime: JAM_STALE_MS,
    enabled: ids.length > 0,
  });
}

/** The latest entries for a handful of jams, grouped by jam id. */
export function useRecentEntries(jamIds: number[], limit = RECENT_ENTRIES_PER_JAM) {
  const options = useMemo(() => recentEntriesQueryOptions(jamIds, limit), [jamIds, limit]);
  const { data, isLoading } = useQuery(options);

  const byJamId = useMemo(() => {
    const map = new Map<number, RecentEntry[]>();
    for (const entry of data?.entries ?? []) {
      const list = map.get(entry.jamId);
      if (list) list.push(entry);
      else map.set(entry.jamId, [entry]);
    }
    return map;
  }, [data]);

  // `enabled: false` leaves isLoading true forever; with no ids there is
  // nothing pending, so callers should see a settled empty result.
  return { byJamId, isLoading: jamIds.length > 0 && isLoading };
}
