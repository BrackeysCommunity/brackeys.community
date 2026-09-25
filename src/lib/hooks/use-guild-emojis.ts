import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

/** The guild's custom emojis, fetched once per session for the `:` picker. */
export function useGuildEmojis({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...orpc.listGuildEmojis.queryOptions(),
    enabled,
    staleTime: STALE.taxonomy,
  });
}
