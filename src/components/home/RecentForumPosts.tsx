import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { useMemo } from "react";

import { ForumPostCard } from "@/components/forum/ForumPostCard";
import { Section, SectionAction } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { authStore } from "@/lib/auth-store";
import { useFlag } from "@/lib/hooks/use-flag";
import { fadeUp } from "@/lib/motion";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

const LIMIT = 3;

/**
 * "From the forum": devlogs from what the viewer follows first, then the
 * For you ranking to fill the row. Absent while the forum is dark, and
 * when there's nothing to show — an empty forum isn't worth a section.
 */
export function RecentForumPosts() {
  const forumOn = useFlag("forum-enabled");
  const signedIn = useStore(authStore, (s) => Boolean(s.session?.user));
  const following = useQuery({
    ...orpc.listForumPosts.queryOptions({
      input: { sort: "following", kind: "devlog", limit: LIMIT },
    }),
    enabled: forumOn && signedIn,
    staleTime: STALE.listing,
  });
  const hot = useQuery({
    ...orpc.listForumPosts.queryOptions({ input: { sort: "hot", limit: LIMIT * 2 } }),
    enabled: forumOn,
    staleTime: STALE.listing,
  });

  const posts = useMemo(() => {
    const seen = new Set<number>();
    return [...(following.data?.posts ?? []), ...(hot.data?.posts ?? [])]
      .filter((post) => (seen.has(post.id) ? false : (seen.add(post.id), true)))
      .slice(0, LIMIT);
  }, [following.data, hot.data]);

  if (!forumOn) return null;
  if (!hot.isLoading && posts.length === 0) return null;

  // Its own staggered child, so a dark forum leaves no empty slot behind.
  return (
    <motion.div variants={fadeUp}>
      <Section
        id="forum"
        title="FROM THE FORUM"
        blurb="Devlogs from people you follow, and what's getting talked about."
        action={<SectionAction to="/forum">OPEN FORUM</SectionAction>}
      >
        {hot.isLoading ? (
          <div className="grid gap-4 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: LIMIT }, (_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-3">
            {posts.map((post) => (
              <ForumPostCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </Section>
    </motion.div>
  );
}
