import {
  Book02Icon,
  ChartIncreaseIcon,
  Clock01Icon,
  HelpCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { forumPostLinkParams } from "@/lib/forum-posts";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { forumCategoriesQueryOptions } from "./forum-queries";
import type { ForumFeedSearch } from "./forum-search";
import { CategorySwatch } from "./ForumPostCard";

const RAIL_LINK = cn(
  "relative flex items-center gap-2.5 rounded rounded-l-none py-2 pr-2 pl-4 text-sm transition-colors",
  "text-muted-foreground hover:bg-muted/15 hover:text-foreground",
);
const RAIL_LINK_ACTIVE = "bg-muted/25 text-foreground";

function ActiveBar() {
  return <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" />;
}

function RailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5 border-r border-muted/30 pr-2">
      <MicroLabel as="span" className="pb-2 pl-4 uppercase">
        {label}
      </MicroLabel>
      {children}
    </nav>
  );
}

type FeedView = {
  label: string;
  icon: IconSvgElement;
  search: ForumFeedSearch;
};

const FEED_VIEWS: FeedView[] = [
  { label: "Latest", icon: Clock01Icon, search: {} },
  { label: "Top this week", icon: ChartIncreaseIcon, search: { sort: "top", window: "week" } },
  { label: "Devlogs", icon: Book02Icon, search: { kind: "devlog" } },
  { label: "Questions", icon: HelpCircleIcon, search: { kind: "question" } },
];

function sameView(current: ForumFeedSearch, view: ForumFeedSearch): boolean {
  return (
    (current.sort ?? "latest") === (view.sort ?? "latest") &&
    (current.kind ?? null) === (view.kind ?? null) &&
    !current.tag &&
    !current.team
  );
}

/** Feeds, boards and the viewer's teams — `SettingsLayout`'s rail, forum-shaped. */
function ForumRail() {
  const location = useRouterState({ select: (s) => s.location });
  const onFeed = location.pathname === "/forum" || location.pathname === "/forum/";
  const search = location.search as ForumFeedSearch;
  const { session } = useStore(authStore);
  const { data: categories } = useQuery(forumCategoriesQueryOptions());
  const { data: teams } = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: Boolean(session?.user),
    staleTime: STALE.listing,
  });
  const visibleTeams = (teams ?? []).filter((team) => !team.hidden);

  return (
    <aside className="hidden flex-col gap-6 lg:sticky lg:top-4 lg:flex lg:self-start">
      <RailGroup label="Feed">
        {FEED_VIEWS.map((view) => {
          const active = onFeed && sameView(search, view.search);
          return (
            <Link
              key={view.label}
              to="/forum"
              search={view.search}
              className={cn(RAIL_LINK, active && RAIL_LINK_ACTIVE)}
            >
              {active ? <ActiveBar /> : null}
              <HugeiconsIcon icon={view.icon} size={16} />
              {view.label}
            </Link>
          );
        })}
      </RailGroup>

      <RailGroup label="Categories">
        {categories
          ? categories.map((category) => (
              <Link
                key={category.slug}
                to="/forum/c/$categorySlug"
                params={{ categorySlug: category.slug }}
                className={RAIL_LINK}
                activeProps={{ className: RAIL_LINK_ACTIVE }}
              >
                {({ isActive }) => (
                  <>
                    {isActive ? <ActiveBar /> : null}
                    <CategorySwatch color={category.color} />
                    <span className="truncate">{category.name}</span>
                  </>
                )}
              </Link>
            ))
          : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="mx-4 my-2 h-4" />)}
      </RailGroup>

      {visibleTeams.length > 0 ? (
        <RailGroup label="Your teams">
          {visibleTeams.map((team) => {
            const active = onFeed && search.team === team.id;
            return (
              <Link
                key={team.id}
                to="/forum"
                search={{ team: team.id, kind: "devlog" }}
                className={cn(RAIL_LINK, active && RAIL_LINK_ACTIVE)}
              >
                {active ? <ActiveBar /> : null}
                <UserAvatar
                  avatarUrl={team.avatarUrl}
                  username={team.name}
                  size={20}
                  shape="square"
                />
                <span className="truncate">{team.name}</span>
              </Link>
            );
          })}
        </RailGroup>
      ) : null}
    </aside>
  );
}

/** The phone's stand-in for the rail: boards as a scrolling strip. */
export function CategoryStrip({ active }: { active?: string }) {
  const { data: categories } = useQuery(forumCategoriesQueryOptions());
  if (!categories) return null;
  return (
    <nav
      aria-label="Categories"
      className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden"
    >
      {categories.map((category) => (
        <Badge
          key={category.slug}
          variant={active === category.slug ? "secondary" : "outline"}
          size="label"
          className="pointer-events-auto h-7 shrink-0 px-2.5 uppercase"
          render={<Link to="/forum/c/$categorySlug" params={{ categorySlug: category.slug }} />}
        >
          <CategorySwatch color={category.color} />
          {category.name}
        </Badge>
      ))}
    </nav>
  );
}

function TrendingTags() {
  const { data: tags } = useQuery({
    ...orpc.searchForumTags.queryOptions({ input: { query: "", limit: 12 } }),
    staleTime: STALE.listing,
  });
  if (tags && tags.length === 0) return null;
  return (
    <Well className="gap-3 p-4">
      <h2>
        <MicroLabel as="span" className="uppercase">
          Trending tags
        </MicroLabel>
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {tags
          ? tags.map((tag) => (
              <Badge
                key={tag.slug}
                variant="outline"
                size="label"
                className="pointer-events-auto uppercase hover:border-primary/60"
                render={<Link to="/forum/tags/$tag" params={{ tag: tag.slug }} />}
              >
                #{tag.slug}
              </Badge>
            ))
          : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-5 w-16" />)}
      </div>
    </Well>
  );
}

function RecentDevlogs() {
  const { data } = useQuery({
    ...orpc.listForumPosts.queryOptions({ input: { kind: "devlog", limit: 5 } }),
    staleTime: STALE.listing,
  });
  const devlogs = data ? [...data.pinned, ...data.posts].slice(0, 5) : null;
  if (devlogs && devlogs.length === 0) return null;
  return (
    <Well className="gap-3 p-4">
      <h2>
        <MicroLabel as="span" className="uppercase">
          Recent devlogs
        </MicroLabel>
      </h2>
      <ul className="flex flex-col gap-3">
        {devlogs
          ? devlogs.map((post) => (
              <li key={post.id}>
                <Link
                  to="/forum/$postId"
                  params={forumPostLinkParams(post)}
                  className="group flex items-center gap-2.5"
                >
                  <UserAvatar
                    avatarUrl={post.team?.avatarUrl ?? post.author?.avatarUrl}
                    guildAvatarUrl={post.team ? null : post.author?.guildAvatarUrl}
                    username={post.team?.name ?? post.author?.discordUsername}
                    size={32}
                    shape={post.team ? "square" : "round"}
                  />
                  <span className="flex min-w-0 flex-col">
                    <Text as="span" size="sm" bold className="truncate group-hover:text-primary">
                      {post.title}
                    </Text>
                    <MicroLabel as="span" className="truncate uppercase">
                      {post.team?.name ?? "Solo devlog"}
                    </MicroLabel>
                  </span>
                </Link>
              </li>
            ))
          : Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-8" />)}
      </ul>
    </Well>
  );
}

/**
 * Layout A: feeds and boards on the left, the stream in the middle, what's
 * moving on the right. Both rails drop away below `lg`; the phone gets the
 * category strip and the compose button instead.
 */
export function ForumShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-8 py-6 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_18rem]">
      <ForumRail />
      <main className="flex min-w-0 flex-col gap-4">{children}</main>
      <aside className="hidden flex-col gap-5 xl:sticky xl:top-4 xl:flex xl:self-start">
        <TrendingTags />
        <RecentDevlogs />
      </aside>
    </div>
  );
}
