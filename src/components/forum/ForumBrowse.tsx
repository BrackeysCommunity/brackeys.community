import { PinIcon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useMemo } from "react";

import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Badge } from "@/components/ui/badge";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TimeAgo } from "@/components/ui/time-ago";
import { Censored, Heading, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { activeUserStore } from "@/lib/active-user-store";
import { authStore } from "@/lib/auth-store";
import { FORUM_KIND_LABEL, forumPostLinkParams, forumPostTitle } from "@/lib/forum-posts";
import { useInfiniteScrollSentinel } from "@/lib/hooks/use-infinite-scroll-sentinel";
import { useMemberIdentity } from "@/lib/hooks/use-member-identity";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { FollowButton } from "./FollowButton";
import {
  type ForumCard,
  forumCategoriesQueryOptions,
  forumFeedQueryOptions,
} from "./forum-queries";
import { feedFilters, type ForumFeedSearch } from "./forum-search";
import { ForumComposeLauncher } from "./ForumComposer";
import { ActiveFilterChips, FeedControls, ForumFeed, ForumSearchResults } from "./ForumFeed";
import { CategorySwatch, TagBadges } from "./ForumPostCard";
import { CategoryStrip, ForumSearchBox, ForumShell } from "./ForumShell";

function PageHeader({
  eyebrow,
  title,
  blurb,
  swatch,
  action,
}: {
  eyebrow: string;
  title: string;
  blurb?: string | null;
  swatch?: string | null;
  action?: React.ReactNode;
}) {
  return (
    <Well
      notchOpts
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-col gap-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <MicroLabel className="uppercase">{eyebrow}</MicroLabel>
          {action}
        </div>
        <Heading as="h1" className="flex items-center gap-3 text-2xl md:text-3xl">
          {swatch !== undefined ? <CategorySwatch color={swatch} className="size-3" /> : null}
          {title}
        </Heading>
        {blurb ? (
          <Text size="sm" variant="muted" className="max-w-prose">
            {blurb}
          </Text>
        ) : null}
      </div>
    </Well>
  );
}

function useTeamName(teamId: string | undefined) {
  const { session } = useStore(authStore);
  const { data } = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: Boolean(session?.user && teamId),
    staleTime: STALE.listing,
  });
  return data?.find((team) => team.id === teamId)?.name ?? null;
}

/** `/forum` — layout A, Pulse, or search results. */
export function ForumHomePage({ search }: { search: ForumFeedSearch }) {
  const teamName = useTeamName(search.team);
  const pulse = search.view === "pulse";
  const query = search.q?.trim();

  if (query && query.length >= 2) {
    return (
      <ForumShell>
        <PageHeader eyebrow="Search" title={`“${query}”`} />
        <ForumSearchResults query={query} kind={search.kind} />
      </ForumShell>
    );
  }

  return (
    <ForumShell>
      <Heading as="h1" className="sr-only">
        {pulse ? "Pulse" : "Forum"}
      </Heading>
      <ForumComposeLauncher />
      <div className="flex items-center gap-2 lg:hidden">
        <div className="flex-1">
          <ForumSearchBox />
        </div>
        <Badge
          variant={pulse ? "secondary" : "outline"}
          size="label"
          className="pointer-events-auto h-8 px-2.5 uppercase"
          render={<Link to="/forum" search={pulse ? {} : { view: "pulse" }} />}
        >
          Pulse
        </Badge>
      </div>
      <CategoryStrip />
      {pulse ? (
        <PageHeader
          eyebrow="Pulse"
          title="What people are up to"
          blurb="Short posts as they land — progress, clips, small wins."
        />
      ) : (
        <FeedControls search={search} personal />
      )}
      <ActiveFilterChips search={search} teamName={teamName} />
      <ForumFeed filters={feedFilters(search)} compact={pulse} />
    </ForumShell>
  );
}

/** `/forum/tags/$tag` — the feed, narrowed to one tag. */
export function ForumTagPage({ tag, search }: { tag: string; search: ForumFeedSearch }) {
  return (
    <ForumShell>
      <PageHeader
        eyebrow="Tag"
        title={`#${tag}`}
        action={<FollowButton type="tag" target={tag} />}
      />
      <FeedControls search={search} />
      <ForumFeed
        filters={feedFilters(search, { tag })}
        empty={
          <Well variant="ghost" className="items-center gap-1 p-8 backdrop-blur-none">
            <MicroLabel>NOTHING TAGGED #{tag.toUpperCase()} YET</MicroLabel>
            <Text size="xs" variant="muted">
              Add the tag to a post and it shows up here.
            </Text>
          </Well>
        }
      />
    </ForumShell>
  );
}

function ThreadRow({ post }: { post: ForumCard }) {
  const { name } = useMemberIdentity();
  const who = post.team?.name ?? (post.author ? name(post.author, "unknown") : "deleted user");
  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_2.5rem_4.5rem_5.5rem]",
        post.pinnedAt && "bg-warning/5",
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {post.pinnedAt ? (
            <HugeiconsIcon
              icon={PinIcon}
              size={14}
              className="shrink-0 text-warning"
              aria-label="Pinned"
            />
          ) : null}
          <Link
            to="/forum/$postId"
            params={forumPostLinkParams(post)}
            className="truncate font-medium text-foreground hover:text-primary"
          >
            <Censored>{forumPostTitle(post)}</Censored>
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MicroLabel as="span" className="uppercase">
            {FORUM_KIND_LABEL[post.kind]} · {who}
          </MicroLabel>
          {post.solved ? (
            <Badge variant="success" size="label">
              <HugeiconsIcon icon={Tick01Icon} />
              SOLVED
            </Badge>
          ) : null}
          <TagBadges tags={post.tags} />
        </div>
      </div>
      <span className="hidden sm:block">
        <UserAvatar
          avatarUrl={post.team?.avatarUrl ?? post.author?.avatarUrl}
          guildAvatarUrl={post.team ? null : post.author?.guildAvatarUrl}
          username={who}
          size={26}
        />
      </span>
      <Text as="span" size="sm" bold align="right" className="tabular-nums">
        {post.commentCount}
        <span className="sr-only"> replies</span>
      </Text>
      <MicroLabel as="span" className="hidden text-right uppercase sm:block">
        {post.publishedAt ? <TimeAgo date={post.publishedAt} /> : null}
      </MicroLabel>
    </li>
  );
}

/** Layout B's thread table: the category board's denser read. */
function ThreadTable({ category, search }: { category: string; search: ForumFeedSearch }) {
  const query = useInfiniteQuery(forumFeedQueryOptions(feedFilters(search, { category })));
  const rows = useMemo(() => {
    const pages = query.data?.pages ?? [];
    return [...(pages[0]?.pinned ?? []), ...pages.flatMap((page) => page.posts)];
  }, [query.data]);
  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage: Boolean(query.hasNextPage),
    isFetching: query.isFetchingNextPage,
    fetchNext: query.fetchNextPage,
  });

  return (
    <Well className="gap-0 p-0 backdrop-blur-none">
      <div className="hidden grid-cols-[minmax(0,1fr)_2.5rem_4.5rem_5.5rem] gap-x-4 border-b border-muted/40 px-4 py-2.5 sm:grid">
        <MicroLabel as="span" className="uppercase">
          Thread
        </MicroLabel>
        <span />
        <MicroLabel as="span" className="text-right uppercase">
          Replies
        </MicroLabel>
        <MicroLabel as="span" className="text-right uppercase">
          Posted
        </MicroLabel>
      </div>
      {query.isLoading ? (
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1 p-8">
          <MicroLabel>NO THREADS YET</MicroLabel>
          <Text size="xs" variant="muted">
            Start the first one.
          </Text>
        </div>
      ) : (
        <ul className="divide-y divide-dashed divide-muted/40">
          {rows.map((post) => (
            <ThreadRow key={post.id} post={post} />
          ))}
        </ul>
      )}
      <div ref={sentinelRef} aria-hidden />
      {query.isFetchingNextPage ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : null}
    </Well>
  );
}

/** `/forum/c/$categorySlug` — one board. */
export function ForumCategoryPage({
  categorySlug,
  search,
}: {
  categorySlug: string;
  search: ForumFeedSearch;
}) {
  const { data: categories, isLoading } = useQuery(forumCategoriesQueryOptions());
  const category = categories?.find((c) => c.slug === categorySlug);
  const isStaff = useStore(activeUserStore, (s) => s.profile?.isStaff ?? false);

  if (!isLoading && categories && !category) {
    return <NotFoundPage subject="Category" message="There's no forum category by that name." />;
  }

  return (
    <ForumShell>
      {category ? (
        <PageHeader
          eyebrow="Category"
          title={category.name}
          blurb={category.description}
          swatch={category.color}
          action={<FollowButton type="category" target={category.slug} />}
        />
      ) : (
        <Skeleton className="h-28" />
      )}
      {category && (category.postingPolicy === "anyone" || isStaff) ? (
        <ForumComposeLauncher defaultCategory={category.slug} />
      ) : null}
      <CategoryStrip active={categorySlug} />
      <FeedControls search={search} />
      <ActiveFilterChips search={search} />
      <ThreadTable category={categorySlug} search={search} />
    </ForumShell>
  );
}
