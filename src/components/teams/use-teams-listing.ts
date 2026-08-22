import { offsetInfiniteQueryOptions } from "@/lib/offset-infinite-query";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { DEFAULT_SORT, teamFacetInput, type TeamsSearch } from "./teams-filters";

export const TEAMS_PAGE_SIZE = 24;

export function teamsListQueryOptions(search: TeamsSearch) {
  const listInput = { ...teamFacetInput(search), sort: search.sort ?? DEFAULT_SORT };
  return offsetInfiniteQueryOptions({
    queryKey: ["listTeams", listInput],
    pageSize: TEAMS_PAGE_SIZE,
    fetchPage: (offset) => client.listTeams({ ...listInput, limit: TEAMS_PAGE_SIZE, offset }),
    staleTime: STALE.viewer,
  });
}
