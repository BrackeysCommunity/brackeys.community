import {
  Book02Icon,
  ChartIncreaseIcon,
  Clock01Icon,
  FireIcon,
  HelpCircleIcon,
  PulseIcon,
  RssIcon,
  Search01Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TimeAgo } from "@/components/ui/time-ago";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { authStore } from "@/lib/auth-store";
import { formatCount } from "@/lib/format-count";
import { forumPostLinkParams } from "@/lib/forum-posts";
import type { NotchOpts } from "@/lib/notch";
import { teamLinkParams } from "@/lib/team-links";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { forumCategoriesQueryOptions, useForumFollows } from "./forum-queries";
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
  { label: "For you", icon: FireIcon, search: { sort: "hot" } },
  { label: "Following", icon: UserCheck01Icon, search: { sort: "following" } },
  { label: "Pulse", icon: PulseIcon, search: { view: "pulse" } },
  { label: "Top this week", icon: ChartIncreaseIcon, search: { sort: "top", window: "week" } },
  { label: "Devlogs", icon: Book02Icon, search: { kind: "devlog" } },
  { label: "Questions", icon: HelpCircleIcon, search: { kind: "question" } },
];

function sameView(current: ForumFeedSearch, view: ForumFeedSearch): boolean {
  return (
    (current.sort ?? "latest") === (view.sort ?? "latest") &&
    (current.kind ?? null) === (view.kind ?? null) &&
    (current.view ?? null) === (view.view ?? null) &&
    !current.tag &&
    !current.team &&
    !current.author &&
    !current.q
  );
}

/** Posts, devlogs and questions by what they say — `?q=` on `/forum`. */
export function ForumSearchBox() {
  const navigate = useNavigate();
  const current = useRouterState({
    select: (s) => (s.location.search as ForumFeedSearch).q ?? "",
  });
  const [text, setText] = useState(current);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        void navigate({ to: "/forum", search: q.length >= 2 ? { q } : {} });
      }}
      className="relative"
    >
      <HugeiconsIcon
        icon={Search01Icon}
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search the forum"
        aria-label="Search the forum"
        maxLength={100}
        className="h-8 pl-8"
      />
    </form>
  );
}

/** The viewer's unpublished devlogs, each opening on its page to edit or publish. */
function DraftsGroup() {
  const { session } = useStore(authStore);
  const { data } = useQuery({
    ...orpc.listMyForumDrafts.queryOptions(),
    enabled: Boolean(session?.user),
    staleTime: STALE.viewer,
  });
  if (!data || data.length === 0) return null;
  return (
    <RailGroup label="My drafts">
      {data.map((draft) => (
        <Link
          key={draft.id}
          to="/forum/$postId"
          params={forumPostLinkParams(draft)}
          className={RAIL_LINK}
          activeProps={{ className: RAIL_LINK_ACTIVE }}
        >
          <span className="truncate">{draft.title ?? "Untitled draft"}</span>
        </Link>
      ))}
    </RailGroup>
  );
}

/** What the viewer follows, one click from its board or page. */
function FollowingGroup() {
  const { data } = useForumFollows();
  if (!data) return null;
  const rows = [
    ...data.teams.map((team) => (
      <Link
        key={`t-${team.id}`}
        to="/teams/$teamId"
        params={teamLinkParams(team)}
        className={RAIL_LINK}
      >
        <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={18} />
        <span className="truncate">{team.name}</span>
      </Link>
    )),
    ...data.categories.map((category) => (
      <Link
        key={`c-${category.slug}`}
        to="/forum/c/$categorySlug"
        params={{ categorySlug: category.slug }}
        className={RAIL_LINK}
      >
        <CategorySwatch color={category.color} />
        <span className="truncate">{category.name}</span>
      </Link>
    )),
    ...data.tags.map((tag) => (
      <Link key={`g-${tag}`} to="/forum/tags/$tag" params={{ tag }} className={RAIL_LINK}>
        <span className="truncate">#{tag}</span>
      </Link>
    )),
  ];
  if (rows.length === 0) return null;
  return <RailGroup label="Following">{rows.slice(0, 12)}</RailGroup>;
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
      <ForumSearchBox />
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

      <FollowingGroup />
      <DraftsGroup />

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
                <UserAvatar avatarUrl={team.avatarUrl} username={team.name} size={20} />
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

// The sidebar panels stack with their notches alternating corners.
const NOTCH_A: NotchOpts = { size: 16, corners: ["tl", "br"] };
const NOTCH_B: NotchOpts = { size: 16, corners: ["tr", "bl"] };

function TrendingTags() {
  const { data: tags } = useQuery({
    ...orpc.searchForumTags.queryOptions({ input: { query: "", limit: 12 } }),
    staleTime: STALE.listing,
  });
  if (tags && tags.length === 0) return null;
  return (
    <Well notchOpts={NOTCH_A} surfaceClassName="gap-3 p-4">
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
    <Well notchOpts={NOTCH_A} surfaceClassName="gap-3 p-4">
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
      <Link
        to="/forum"
        search={{ kind: "devlog" }}
        className="text-xs text-muted-foreground hover:text-primary"
      >
        All devlogs
      </Link>
    </Well>
  );
}

/** Open questions, newest first — the sidebar's nudge to help someone out. */
function UnansweredQuestions() {
  const { data } = useQuery({
    ...orpc.listForumPosts.queryOptions({
      input: { kind: "question", unsolved: true, limit: 4 },
    }),
    staleTime: STALE.listing,
  });
  const questions = data?.posts ?? null;
  if (questions && questions.length === 0) return null;
  return (
    <Well notchOpts={NOTCH_B} surfaceClassName="gap-3 p-4">
      <h2>
        <MicroLabel as="span" className="uppercase">
          Needs an answer
        </MicroLabel>
      </h2>
      <ul className="flex flex-col gap-3">
        {questions
          ? questions.map((post) => (
              <li key={post.id}>
                <Link
                  to="/forum/$postId"
                  params={forumPostLinkParams(post)}
                  className="group flex flex-col gap-0.5"
                >
                  <Text as="span" size="sm" bold className="line-clamp-2 group-hover:text-primary">
                    {post.title}
                  </Text>
                  <MicroLabel as="span" className="uppercase tabular-nums">
                    {post.commentCount === 0
                      ? "No replies yet"
                      : `${formatCount(post.commentCount)} ${post.commentCount === 1 ? "reply" : "replies"}`}
                    {post.publishedAt ? (
                      <>
                        {" · "}
                        <TimeAgo date={post.publishedAt} />
                      </>
                    ) : null}
                  </MicroLabel>
                </Link>
              </li>
            ))
          : Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-9" />)}
      </ul>
      <Link
        to="/forum"
        search={{ kind: "question" }}
        className="text-xs text-muted-foreground hover:text-primary"
      >
        All questions
      </Link>
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
        <UnansweredQuestions />
        <RecentDevlogs />
        <a
          href="/forum/feed.xml"
          className="flex items-center gap-2 pl-1 text-xs text-muted-foreground hover:text-primary"
        >
          <HugeiconsIcon icon={RssIcon} size={14} />
          Devlog feed (Atom)
        </a>
      </aside>
    </div>
  );
}
