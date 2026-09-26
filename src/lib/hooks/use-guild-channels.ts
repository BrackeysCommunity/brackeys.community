import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

/** The guild's public channels, fetched once and shared by every `<#id>` chip. */
export function useGuildChannels() {
  return useQuery({
    ...orpc.listGuildChannels.queryOptions(),
    staleTime: STALE.taxonomy,
  });
}
