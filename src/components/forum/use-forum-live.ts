import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useState } from "react";

import { authStore } from "@/lib/auth-store";
import { orpc } from "@/orpc/client";

import type { ForumFeedFilters } from "./forum-queries";

type LiveEvent = { id: number; kind: string; category: string; authorId: string | null };

/**
 * How many posts matching this feed went out since it loaded — the "N new
 * posts" pill. Fed by `/api/forum/stream`; the viewer's own posts don't
 * count, since publishing already refreshes the feed they're looking at.
 * Only a Latest feed takes new posts at the top, so only it listens.
 */
export function useForumLiveCount(filters: ForumFeedFilters) {
  const queryClient = useQueryClient();
  const viewerId = useStore(authStore, (s) => s.session?.user?.id ?? null);
  const listening = (filters.sort ?? "latest") === "latest" && !filters.tag && !filters.teamId;
  const { kind, category } = filters;
  // Keyed by the feed it counts for, so switching feeds starts from zero
  // without resetting state inside the effect.
  const feedKey = `${kind ?? ""}|${category ?? ""}`;
  const [fresh, setFresh] = useState<{ key: string; ids: number[] }>({ key: feedKey, ids: [] });

  useEffect(() => {
    if (!listening || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/forum/stream");
    source.addEventListener("post", (message) => {
      let event: LiveEvent;
      try {
        event = JSON.parse((message as MessageEvent<string>).data) as LiveEvent;
      } catch {
        return;
      }
      if (event.authorId && event.authorId === viewerId) return;
      if (kind && event.kind !== kind) return;
      if (category && event.category !== category) return;
      setFresh((prev) =>
        prev.key !== feedKey
          ? { key: feedKey, ids: [event.id] }
          : prev.ids.includes(event.id)
            ? prev
            : { key: feedKey, ids: [...prev.ids, event.id] },
      );
    });
    // A dark forum answers 404 and a dropped connection retries on its own;
    // either way the pill just stays quiet.
    return () => source.close();
  }, [listening, kind, category, viewerId, feedKey]);

  const showNew = useCallback(() => {
    setFresh({ key: feedKey, ids: [] });
    void queryClient.invalidateQueries({ queryKey: orpc.listForumPosts.key() });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [queryClient, feedKey]);

  return { count: listening && fresh.key === feedKey ? fresh.ids.length : 0, showNew };
}
