import { infiniteQueryOptions } from "@tanstack/react-query";

import { client } from "@/orpc/client";

import { DEFAULT_SORT, memberFacetInput, type MembersSearch } from "./members-filters";

export const MEMBERS_PAGE_SIZE = 24;

export function membersListQueryOptions(search: MembersSearch) {
  const listInput = { ...memberFacetInput(search), sort: search.sort ?? DEFAULT_SORT };
  return infiniteQueryOptions({
    queryKey: ["listMembers", listInput],
    queryFn: ({ pageParam }) =>
      client.listMembers({ ...listInput, limit: MEMBERS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * MEMBERS_PAGE_SIZE;
      return fetched >= (lastPage.total ?? 0) ? undefined : fetched;
    },
    staleTime: 30 * 1000,
  });
}

/** `tz`'s offset comes from the browser's clock, so that one facet can't be prefetched. */
export function membersListingIsShareable(search: MembersSearch): boolean {
  return search.tz == null;
}
