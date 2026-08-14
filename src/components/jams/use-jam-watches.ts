import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useMemo } from "react";

import { authStore } from "@/lib/auth-store";
import { orpc } from "@/orpc/client";

/**
 * Which jams the viewer watches, as a lookup — the board renders hundreds of
 * cards and each one needs to answer "is this mine?".
 *
 * One query for the whole board, shared by every card through react-query's
 * cache rather than passed down: the board, its three views and the calendar
 * grid all render jam cards from different component trees, and threading a
 * set through all of them would mean touching every view for a marker.
 *
 * `scope: "all"` because a marker is as relevant on an archived jam as an
 * upcoming one — unlike the dashboard strip, which is a countdown list.
 */
export function useJamWatches(): {
  watchedIds: Set<number>;
  intentOf: (jamId: number) => "watching" | "entering" | null;
} {
  const { session } = useStore(authStore);
  const signedIn = session?.user != null;

  const { data } = useQuery({
    ...orpc.listMyJamWatches.queryOptions({ input: { scope: "all", limit: 50 } }),
    enabled: signedIn,
    staleTime: 60 * 1000,
  });

  return useMemo(() => {
    const byId = new Map((data?.jams ?? []).map((jam) => [jam.jamId, jam.intent]));
    return {
      watchedIds: new Set(byId.keys()),
      intentOf: (jamId: number) => byId.get(jamId) ?? null,
    };
  }, [data]);
}
