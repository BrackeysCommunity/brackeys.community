import * as z from "zod";

import { FORUM_POST_KINDS } from "@/lib/forum-posts";

import type { ForumFeedFilters } from "./forum-queries";

/**
 * The feed's filters, all in the URL so a filtered view survives a reload
 * and can be shared. The category and tag pages take the same params on
 * top of their own path segment, so filters combine across them.
 *
 * `view: "pulse"` is the short-post stream; `q` swaps the feed for search
 * results.
 */
export const forumFeedSearchSchema = z.object({
  sort: z.enum(["latest", "top", "hot", "following"]).optional(),
  window: z.enum(["day", "week", "month", "all"]).optional(),
  kind: z.enum(FORUM_POST_KINDS).optional(),
  tag: z.string().max(32).optional(),
  team: z.string().max(64).optional(),
  author: z.string().max(64).optional(),
  view: z.enum(["pulse"]).optional(),
  q: z.string().max(100).optional(),
});

export type ForumFeedSearch = z.infer<typeof forumFeedSearchSchema>;

/** URL → the listing's input. Path segments win over the same search param. */
export function feedFilters(
  search: ForumFeedSearch,
  fixed: { category?: string; tag?: string } = {},
): ForumFeedFilters {
  return {
    sort: search.sort ?? "latest",
    window: search.sort === "top" ? (search.window ?? "week") : undefined,
    kind: search.view === "pulse" ? "post" : search.kind,
    category: fixed.category,
    tag: fixed.tag ?? search.tag,
    teamId: search.team,
    authorId: search.author,
  };
}
