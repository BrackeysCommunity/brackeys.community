import { useQuery } from "@tanstack/react-query";

import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

export interface MentionName {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

const BATCH_LIMIT = 50;
let queued = new Map<string, ((name: MentionName | null) => void)[]>();
let scheduled = false;

async function flush() {
  const batch = queued;
  queued = new Map();
  scheduled = false;
  const handles = [...batch.keys()];
  for (let i = 0; i < handles.length; i += BATCH_LIMIT) {
    const chunk = handles.slice(i, i + BATCH_LIMIT);
    let found: MentionName[] = [];
    try {
      found = await client.resolveMentions({ handles: chunk });
    } catch {
      // Unresolved mentions still render, as their handle.
    }
    const byHandle = new Map(found.map((m) => [m.handle, m]));
    for (const handle of chunk) {
      for (const resolve of batch.get(handle) ?? []) resolve(byHandle.get(handle) ?? null);
    }
  }
}

/** One mention's display name; every call in the same tick shares a request. */
export function loadMentionName(handle: string): Promise<MentionName | null> {
  const key = handle.toLowerCase();
  return new Promise((resolve) => {
    queued.set(key, [...(queued.get(key) ?? []), resolve]);
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => void flush(), 0);
    }
  });
}

export function useMentionName(handle: string) {
  return useQuery({
    queryKey: ["mentionName", handle.toLowerCase()],
    queryFn: () => loadMentionName(handle),
    staleTime: STALE.listing,
  });
}
