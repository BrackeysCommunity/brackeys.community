import { useQuery } from "@tanstack/react-query";

import { CollabPostCard } from "@/components/collab/CollabPostCard";
import {
  POST_LIMIT,
  recentCollabPostsQueryOptions,
} from "@/components/home/use-recent-collab-posts";
import { Section, SectionAction } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

/** The board's own list-row height, so the skeleton doesn't resize on load. */
const LIST_ROW_ESTIMATE = 86;

/**
 * The collab board's latest roles, as a ticker.
 *
 * Renders `CollabPostCard` — the board's list row — rather than a local
 * row of its own. The two used to be separate implementations of the same
 * idea, so the home page's version silently missed everything the board
 * gained: cover thumbnails, FEATURED and CLOSED badges, the jam and team
 * chips. Sharing the row means the next thing added to a board row shows
 * up here too instead of drifting apart again.
 */
export function RecentCollabPosts() {
  const { data, isLoading } = useQuery(recentCollabPostsQueryOptions());

  const posts = data?.posts ?? [];

  return (
    <Section
      id="collab"
      title="COLLAB BOARD"
      blurb="The latest roles off the board."
      action={<SectionAction to="/collab">OPEN BOARD</SectionAction>}
    >
      {isLoading ? (
        // Same stack and row height the board's own feed skeleton uses.
        <div className="flex flex-col gap-2" aria-hidden>
          {Array.from({ length: POST_LIMIT }, (_, i) => (
            <Skeleton key={i} className="w-full" style={{ height: LIST_ROW_ESTIMATE }} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <Well>
          <Text
            as="div"
            size="sm"
            variant="muted"
            align="center"
            className="p-6 tracking-widest uppercase"
          >
            No posts yet
          </Text>
        </Well>
      ) : (
        <div className="flex flex-col gap-2">
          {posts.map((post) => (
            <CollabPostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </Section>
  );
}
