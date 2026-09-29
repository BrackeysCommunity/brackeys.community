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

/** One channel the list doesn't have, usually an archived thread. */
export function useGuildChannelLookup(id: string, enabled: boolean) {
  return useQuery({
    ...orpc.resolveGuildChannel.queryOptions({ input: { id } }),
    enabled,
    staleTime: STALE.taxonomy,
  });
}

/** The guild's roles, for `<@&id>` chips. */
export function useGuildRoles() {
  return useQuery({
    ...orpc.listGuildRoles.queryOptions(),
    staleTime: STALE.taxonomy,
  });
}
