import { queryOptions } from "@tanstack/react-query";

import { client } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

/** Rows in the ticker. Six reads as a feed; three read as three cards
 * that happened to be next to each other. */
export const POST_LIMIT = 6;

/**
 * Split out of `RecentCollabPosts.tsx` so `/`'s loader can prefetch this
 * without statically pulling in the component — `CollabPostCard`, `Section`,
 * and the rest of the row rendering have no business in the root's preload
 * graph. See `docs/plans/15-preload-graph.md` §3.2.
 */
export function recentCollabPostsQueryOptions() {
  return queryOptions({
    queryKey: ["recent-collab-posts", POST_LIMIT],
    queryFn: () =>
      client.listPosts({
        sortBy: "createdAt",
        sortOrder: "desc",
        limit: POST_LIMIT,
        offset: 0,
      }),
    staleTime: STALE.listing,
  });
}
