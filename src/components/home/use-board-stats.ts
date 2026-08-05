import { useQuery } from "@tanstack/react-query";

import { client } from "@/orpc/client";

/**
 * The collab board's open-role counts, shared by the desktop feature rail
 * and the mobile tile dock on one query key so the two home pages read a
 * single cache entry — the same arrangement `useBoardQuery` enforces for
 * the jam board.
 */
export function useBoardStats() {
  const { data, isLoading } = useQuery({
    queryKey: ["collab-board-stats"],
    queryFn: () => client.getBoardStats({}),
    staleTime: 60 * 1000,
  });

  return { openRoles: data?.open.all ?? 0, isLoading };
}
