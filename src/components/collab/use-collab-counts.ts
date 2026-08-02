import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { collabFilterInput, collabPeopleFilterInput, collabStore } from "@/lib/collab-store";
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

/** Standing open-role counts per type, ignoring the active filters. */
export function useCollabOpenCounts() {
  return useQuery({
    queryKey: ["collabOpenRoles"],
    queryFn: () => client.countPostsByType({ status: "recruiting" }),
    staleTime: 60 * 1000,
  });
}

/**
 * Live result count for whatever the feed is currently showing. Posts
 * come free from the type-count facets; people need their own cheap
 * head request since they aren't typed.
 */
export function useCollabResultCount(): number | null {
  const filters = useStore(collabStore, (s) => s.filters);
  const isPeople = filters.listingType === "people";
  const { data: typeCounts } = useCollabTypeCounts();

  const peopleInput = collabPeopleFilterInput(filters);
  const { data: peopleCount } = useQuery({
    queryKey: ["collabPeopleCount", peopleInput],
    queryFn: () => client.listAvailableUsers({ ...peopleInput, limit: 1, offset: 0 }),
    staleTime: 15 * 1000,
    enabled: isPeople,
    placeholderData: (previous) => previous,
  });

  if (isPeople) return peopleCount?.total ?? null;
  if (!typeCounts) return null;
  return filters.type ? typeCounts[filters.type] : typeCounts.all;
}
