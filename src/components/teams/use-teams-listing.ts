import { infiniteQueryOptions } from "@tanstack/react-query";

import { client } from "@/orpc/client";

import { DEFAULT_SORT, teamFacetInput, type TeamsSearch } from "./teams-filters";

export const TEAMS_PAGE_SIZE = 24;

export function teamsListQueryOptions(search: TeamsSearch) {
  const listInput = { ...teamFacetInput(search), sort: search.sort ?? DEFAULT_SORT };
  return infiniteQueryOptions({
    queryKey: ["listTeams", listInput],
    queryFn: ({ pageParam }) =>
      client.listTeams({ ...listInput, limit: TEAMS_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * TEAMS_PAGE_SIZE;
      return fetched >= (lastPage.total ?? 0) ? undefined : fetched;
    },
    staleTime: 30 * 1000,
  });
}
