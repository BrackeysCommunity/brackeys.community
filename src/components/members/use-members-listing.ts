import { offsetInfiniteQueryOptions } from "@/lib/offset-infinite-query";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { DEFAULT_SORT, memberFacetInput, type MembersSearch } from "./members-filters";

export const MEMBERS_PAGE_SIZE = 24;

export function membersListQueryOptions(search: MembersSearch) {
  const listInput = { ...memberFacetInput(search), sort: search.sort ?? DEFAULT_SORT };
  return offsetInfiniteQueryOptions({
    queryKey: ["listMembers", listInput],
    pageSize: MEMBERS_PAGE_SIZE,
    fetchPage: (offset) => client.listMembers({ ...listInput, limit: MEMBERS_PAGE_SIZE, offset }),
    staleTime: STALE.viewer,
  });
}

/** `tz`'s offset comes from the browser's clock, so that one facet can't be prefetched. */
export function membersListingIsShareable(search: MembersSearch): boolean {
  return search.tz == null;
}
