import { ArrowRight02Icon, PencilEdit01Icon, RssIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/ui/time-ago";
import { Censored, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { forumPostLinkParams } from "@/lib/forum-posts";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { FollowButton } from "./FollowButton";
import { EMPTY_DRAFT, readForumDraft, writeForumDraft } from "./forum-draft";

/** Devlogs a team page previews; the rest are a click away on the forum. */
const PREVIEW = 5;

export function useTeamDevlogs(teamId: string) {
  return useQuery({
    ...orpc.listForumPosts.queryOptions({
      input: { kind: "devlog", teamId, limit: PREVIEW },
    }),
    staleTime: STALE.listing,
  });
}

/**
 * The team page's DEVLOG section body: the latest entries, the team's
 * series, and the ways to follow or write one. The team page supplies the
 * section chrome and hides it while the forum is dark.
 */
export function TeamDevlog({
  team,
  isMember,
}: {
  team: { id: string; slug: string; name: string };
  isMember: boolean;
}) {
  const navigate = useNavigate();
  const { data } = useTeamDevlogs(team.id);
  const { data: series } = useQuery({
    ...orpc.listForumSeries.queryOptions({ input: { teamId: team.id } }),
    staleTime: STALE.listing,
  });
  const posts = data?.posts ?? [];

  // The composer lives on the forum; a member arriving from here starts a
  // devlog already posting as this team, unless they were mid-way through
  // writing something else.
  const writeDevlog = () => {
    if (!readForumDraft()) writeForumDraft({ ...EMPTY_DRAFT, kind: "devlog", teamId: team.id });
    void navigate({ to: "/forum", search: { kind: "devlog", team: team.id } });
  };

  return (
    <div className="flex flex-col gap-3">
      {posts.length > 0 ? (
        <Well className="gap-0 divide-y divide-dashed divide-muted/40 p-0 backdrop-blur-none">
          {posts.map((post) => (
            <Link
              key={post.id}
              to="/forum/$postId"
              params={forumPostLinkParams(post)}
              className="group flex items-center gap-3 px-4 py-2.5"
            >
              {post.seriesIndex != null ? (
                <Badge variant="outline" size="label" className="shrink-0">
                  #{post.seriesIndex}
                </Badge>
              ) : null}
              <Text
                as="span"
                size="sm"
                bold
                ellipsis
                className="min-w-0 flex-1 group-hover:text-primary"
              >
                <Censored>{post.title}</Censored>
              </Text>
              <MicroLabel as="span" className="shrink-0 uppercase">
                {post.publishedAt ? <TimeAgo date={post.publishedAt} /> : null}
              </MicroLabel>
            </Link>
          ))}
        </Well>
      ) : (
        <Text size="sm" variant="muted">
          {isMember
            ? "No devlogs yet. Write the first — progress, setbacks, what you learned."
            : `${team.name} hasn't written a devlog yet.`}
        </Text>
      )}

      {series && series.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <MicroLabel as="span" className="uppercase">
            Series
          </MicroLabel>
          {series.map((s) => (
            <Badge key={s.id} variant="outline" size="label" className="uppercase">
              {s.title} · {s.entryCount}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {isMember ? (
          <Button size="sm" onClick={writeDevlog} className="tracking-widest">
            <HugeiconsIcon icon={PencilEdit01Icon} />
            WRITE DEVLOG
          </Button>
        ) : null}
        <FollowButton type="team" target={team.id} label="FOLLOW DEVLOG" />
        {posts.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/forum" search={{ kind: "devlog", team: team.id }} />}
            className="tracking-widest"
          >
            ALL DEVLOGS
            <HugeiconsIcon icon={ArrowRight02Icon} />
          </Button>
        ) : null}
        <a
          href={`/teams/${team.slug || team.id}/devlog.xml`}
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"
        >
          <HugeiconsIcon icon={RssIcon} size={14} />
          Atom feed
        </a>
      </div>
    </div>
  );
}
