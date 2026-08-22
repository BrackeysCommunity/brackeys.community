import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

/**
 * The two curated vocabularies, each fetched the same way from every
 * surface — pickers, filter chips, review steps. `listSkills` was declared
 * 9× and `listCollabRoles` 7× with the same options block, and the copies
 * that dropped the `staleTime` split the freshness policy; one hook each
 * keeps the cache behaviour a single decision.
 *
 * Searching variants (`listSkills` with a `search` input) stay bespoke —
 * they key differently on purpose.
 */

export function useSkillsCatalog({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    enabled,
    staleTime: STALE.taxonomy,
  });
}

export function useRolesCatalog({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: {} }),
    enabled,
    staleTime: STALE.taxonomy,
  });
}
