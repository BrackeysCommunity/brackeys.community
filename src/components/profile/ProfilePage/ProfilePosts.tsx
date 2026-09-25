import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { FollowButton } from "@/components/forum/FollowButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/ui/time-ago";
import { Censored, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { FORUM_KIND_LABEL, forumPostLinkParams, forumPostTitle } from "@/lib/forum-posts";
import { useFlag } from "@/lib/hooks/use-flag";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { ProfileSectionHeader } from "./ProfileSectionHeader";

const PREVIEW = 6;

/**
 * `§NN POSTS` — the member's forum posts, devlogs and questions, newest
 * first. Only while the forum is on for the viewer; a visitor gets nothing
 * when there's nothing to show, the owner gets the way in.
 */
export function ProfilePostsSection({
  index,
  profileId,
  isOwner,
}: {
  index: string;
  profileId: string;
  isOwner: boolean;
}) {
  const forumOn = useFlag("forum-enabled");
  const { data } = useQuery({
    ...orpc.listForumPosts.queryOptions({ input: { authorId: profileId, limit: PREVIEW } }),
    enabled: forumOn,
    staleTime: STALE.listing,
  });
  if (!forumOn || !data) return null;
  const posts = data.posts;
  if (posts.length === 0 && !isOwner) return null;

  return (
    <section className="flex flex-col gap-3">
      <ProfileSectionHeader
        index={index}
        title="POSTS"
        action={isOwner ? null : <FollowButton type="user" target={profileId} size="xs" />}
      />
      {posts.length === 0 ? (
        <Well variant="ghost" className="items-start gap-2 p-4 backdrop-blur-none">
          <Text size="sm" variant="muted">
            Nothing on the forum yet — share progress, write a devlog, or ask something.
          </Text>
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/forum" />}
            className="tracking-widest"
          >
            OPEN THE FORUM
          </Button>
        </Well>
      ) : (
        <Well className="overflow-hidden p-0">
          <ul className="flex flex-col divide-y divide-muted/30">
            {posts.map((post) => (
              <li key={post.id}>
                <Link
                  to="/forum/$postId"
                  params={forumPostLinkParams(post)}
                  className="group flex items-center gap-3 px-3 py-2.5"
                >
                  <Badge variant="outline" size="label" className="shrink-0 uppercase">
                    {FORUM_KIND_LABEL[post.kind]}
                  </Badge>
                  <Text
                    as="span"
                    size="md"
                    bold
                    ellipsis
                    className="min-w-0 flex-1 group-hover:text-primary"
                  >
                    <Censored>{forumPostTitle(post)}</Censored>
                  </Text>
                  <MicroLabel as="span" className="shrink-0 uppercase">
                    {post.publishedAt ? <TimeAgo date={post.publishedAt} /> : null}
                  </MicroLabel>
                </Link>
              </li>
            ))}
          </ul>
          {data.nextCursor ? (
            <div className="border-t border-muted/30 p-2">
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link to="/forum" search={{ author: profileId }} />}
                className="tracking-widest"
              >
                ALL POSTS
                <HugeiconsIcon icon={ArrowRight02Icon} />
              </Button>
            </div>
          ) : null}
        </Well>
      )}
    </section>
  );
}
