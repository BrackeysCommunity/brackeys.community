import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { collabFilterInput, collabStore } from "@/lib/collab-store";
import { client } from "@/orpc/client";

/**
 * Per-type post counts under every active filter *except* the type
 * itself — the numbers on the board's type tabs. Because the type
 * constraint is excluded, `counts.all` doubles as the result count for
 * the current filter set when no type is picked, and `counts[type]` is
 * that count when one is.
 */
export function useCollabTypeCounts() {
  const filters = useStore(collabStore, (s) => s.filters);
  const { type: _type, ...facets } = collabFilterInput(filters);

  return useQuery({
    queryKey: ["collabTypeCounts", facets],
    queryFn: () => client.countPostsByType(facets),
    staleTime: 15 * 1000,
    // Keep the previous numbers on screen while refetching so the tabs
    // don't flash to zero on every keystroke in the search field.
    placeholderData: (previous) => previous,
  });
}

/**
 * Live result count for what the feed is currently showing — free from
 * the type-count facets, which are computed under every filter but the
 * type itself.
 */
export function useCollabResultCount(): number | null {
  const filters = useStore(collabStore, (s) => s.filters);
  const { data: typeCounts } = useCollabTypeCounts();

  if (!typeCounts) return null;
  return filters.type ? typeCounts[filters.type] : typeCounts.all;
}
