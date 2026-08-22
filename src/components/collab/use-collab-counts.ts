import { useQuery } from "@tanstack/react-query";

import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { collabFacetInput, useCollabBoardSearch } from "./collab-filters";

/**
 * Per-type post counts under every active filter *except* the type
 * itself — the numbers on the board's type tabs. Because the type
 * constraint is excluded, `counts.all` doubles as the result count for
 * the current filter set when no type is picked, and `counts[type]` is
 * that count when one is.
 */
export function useCollabTypeCounts() {
  const { search } = useCollabBoardSearch();
  const { type: _type, ...facets } = collabFacetInput(search);

  return useQuery({
    queryKey: ["collabTypeCounts", facets],
    queryFn: () => client.countPostsByType(facets),
    staleTime: STALE.board,
    // Keep the previous numbers on screen while refetching so the tabs
    // don't flash to zero on every keystroke in the search field.
    placeholderData: (previous) => previous,
  });
}

/**
 * Per-skill post counts for the stack picker, under every active filter
 * *except* the stack itself — so each number reads "how many ticking this
 * adds", which is the only true reading when the facet ORs. Under
 * `matchAll` the facet ANDs and narrows instead, so the stack stays in
 * force and each number reads "how many would remain".
 */
export function useCollabSkillCounts() {
  const { search } = useCollabBoardSearch();
  const { skillIds, matchAll, ...facets } = collabFacetInput(search);
  const input = matchAll ? { ...facets, skillIds, matchAll } : facets;

  return useQuery({
    queryKey: ["collabSkillCounts", input],
    queryFn: () => client.countPostsBySkill(input),
    staleTime: STALE.board,
    placeholderData: (previous) => previous,
  });
}

/**
 * Per-role post counts for the role picker — same contract as the skill
 * counts: every filter except the role facet itself applies.
 */
export function useCollabRoleCounts() {
  const { search } = useCollabBoardSearch();
  const { roleIds: _roleIds, ...facets } = collabFacetInput(search);

  return useQuery({
    queryKey: ["collabRoleCounts", facets],
    queryFn: () => client.countPostsByRole(facets),
    staleTime: STALE.board,
    placeholderData: (previous) => previous,
  });
}

/**
 * Live result count for what the feed is currently showing — free from
 * the type-count facets, which are computed under every filter but the
 * type itself.
 */
export function useCollabResultCount(): number | null {
  const { search } = useCollabBoardSearch();
  const { data: typeCounts } = useCollabTypeCounts();

  if (!typeCounts) return null;
  return search.type ? typeCounts[search.type] : typeCounts.all;
}
