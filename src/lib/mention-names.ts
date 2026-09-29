import { useQuery } from "@tanstack/react-query";

import { createBatchLoader } from "@/lib/batch-loader";
import type { DiscordUserName } from "@/lib/discord-mentions";
import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

export interface MentionName {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

const loadMentionNames = createBatchLoader(
  (handles) => client.resolveMentions({ handles }),
  (m) => m.handle,
);

/** One mention's display name; every call in the same tick shares a request. */
export function loadMentionName(handle: string): Promise<MentionName | null> {
  return loadMentionNames(handle.toLowerCase());
}

export function useMentionName(handle: string) {
  return useQuery({
    queryKey: ["mentionName", handle.toLowerCase()],
    queryFn: () => loadMentionName(handle),
    staleTime: STALE.listing,
  });
}

const loadDiscordUserName = createBatchLoader(
  (ids) => client.resolveDiscordUsers({ ids }),
  (u) => u.discordId,
);

/** A Discord `<@id>` mention's name; batched the same way. */
export function useDiscordUserName(discordId: string) {
  return useQuery<DiscordUserName | null>({
    queryKey: ["discordUserName", discordId],
    queryFn: () => loadDiscordUserName(discordId),
    staleTime: STALE.listing,
  });
}
