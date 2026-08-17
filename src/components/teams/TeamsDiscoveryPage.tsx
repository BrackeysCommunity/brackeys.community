import { Add01Icon, Login01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { GraphPaper } from "@/components/ui/graph-paper";
import { PageStack } from "@/components/ui/page-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { VirtualGrid } from "@/components/ui/virtual-grid";
import { Well } from "@/components/ui/well";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReleaseFocusOnOpen } from "@/hooks/use-release-focus";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { fadeIn, fadeUp } from "@/lib/motion";
import { client, orpc } from "@/orpc/client";

import { TeamCreateDrawer } from "./TeamCreateDrawer";
import { TeamDirectoryCard } from "./TeamDirectoryCard";
import {
  CLEARED_TEAM_FILTERS,
  countActiveTeamFilters,
  DEFAULT_SORT,
  type TeamsSearch,
  teamFacetInput,
} from "./teams-filters";
import { TeamsActiveFilters } from "./TeamsActiveFilters";
import { TeamsFilterClearButton, TeamsFilterPanel } from "./TeamsFilterPanel";
import { TeamsFloatingControls, TeamsToolbar } from "./TeamsToolbar";

export type { TeamsSearch, TeamsSort } from "./teams-filters";

const PAGE_SIZE = 24;

/** Directory tile height before a real row is measured — the skeleton's
 * `h-42`, which is what an average filled-in card comes out at. */
const CARD_ROW_ESTIMATE = 168;

/** Above this the toggle row fits inline; below it, it moves to the sheet. */
const WIDE_QUERY = "(min-width: 1024px)";

/**
 * `/teams` — the directory. Browsing comes first: a visitor who lands
 * here without an account should see crews, not a create form. The
 * viewer's own teams ride above the listing as a shelf so "go to my
 * team page" stays one click from the same URL.
 *
 * Filters live in the URL (`?q=&recruiting=&skills=&sort=`) so a
 * narrowed directory is shareable, matching the collab board.
 */
export function TeamsDiscoveryPage() {
  const { session, isPending } = useStore(authStore);
  const navigate = useNavigate();
  const search = (useSearch({ strict: false }) as TeamsSearch) ?? {};

  // The toggle row fits inline on a wide screen; below that it moves into
  // the filter sheet. Two separate thresholds: the floating controls sit
  // above the bottom nav island, which only the mobile shell mounts, so
  // they follow the shell's breakpoint rather than this page's wider one.
  // In between, the sheet is there with its trigger inline.
  const isWide = useMediaQuery(WIDE_QUERY);
  const isMobile = useIsMobile();

  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useReleaseFocusOnOpen(filtersOpen);

  const sort = search.sort ?? DEFAULT_SORT;

  // The current search, read through a ref so the writer below can stay
  // referentially stable — the debounced search box keys its timer on the
  // value it's given, and a writer rebuilt every render would restart it.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  // Merged here rather than through the router's `(prev) => …` reducer:
  // `prev` is typed as the search union of every route, so `sort` comes
  // back as this board's values *plus* the member directory's — and the
  // widened union isn't assignable to `/teams`. This page owns its whole
  // search object, so it can just write it.
  const setSearch = useCallback(
    (next: Partial<TeamsSearch>) => {
      void navigate({
        to: "/teams",
        search: { ...searchRef.current, ...next },
        replace: true,
      });
    },
    [navigate],
  );

  // `?new=1` is a one-shot: open the drawer the moment the flag appears, then
  // strip it so Back doesn't reopen. The open is adjusted during render — the
  // flag is a routing input this component derives from, not an external
  // system to sync with — while the URL rewrite stays in an effect, which is
  // where navigation belongs. Tracking the flag's last-seen value re-arms the
  // pair, so arriving with `?new=1` a second time still opens the drawer.
  const newFlag = Boolean(search.new);
  const [newFlagSeen, setNewFlagSeen] = useState(false);
  if (newFlag !== newFlagSeen) {
    setNewFlagSeen(newFlag);
    if (newFlag) setCreateOpen(true);
  }
  useEffect(() => {
    if (!search.new) return;
    setSearch({ new: undefined });
  }, [search.new, setSearch]);

  const listInput = { ...teamFacetInput(search), sort };

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ["listTeams", listInput],
    queryFn: ({ pageParam = 0 }) =>
      client.listTeams({ ...listInput, limit: PAGE_SIZE, offset: pageParam as number }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE;
      return fetched >= (lastPage.total ?? 0) ? undefined : fetched;
    },
    staleTime: 30 * 1000,
  });

  const teams = useMemo(() => data?.pages.flatMap((p) => p.teams) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;
  const isFiltered = countActiveTeamFilters(search) > 0;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const startTeam = () => {
    if (!isPending && !session?.user) {
      signInWithDiscord();
      return;
    }
    setCreateOpen(true);
  };

  return (
    <PageStack className="flex flex-col gap-8 selection:bg-primary selection:text-white">
      <motion.div variants={fadeUp}>
        <TeamsHero authenticated={!!session?.user} onStart={startTeam} />
      </motion.div>

      {session?.user ? (
        <motion.div variants={fadeUp}>
          <YourTeamsShelf onStart={startTeam} />
        </motion.div>
      ) : null}

      {/* `fadeIn`, not `fadeUp`: the toolbar below is sticky, and a
          transform on its ancestor makes it jump when the rise ends. */}
      <motion.section variants={fadeIn} className="flex flex-col gap-3">
        {/* The controls pin to the top of the scrollport, just under the app
            header — they're the one thing you always want reachable while
            walking a long directory. `--app-header-shift` takes them up into
            the band the header vacates and back down when it returns, so they
            ride with it rather than leaving a gap. The `+1rem` is a gutter
            they keep in both states — parked flush against the viewport edge
            they read as clipped rather than pinned. They carry no surface of
            their own: `z-20` lands them on top of the header's fixed scrim,
            which is what the grid dissolves into on its way past. The count
            and chips are a readout of the directory rather than a control, so
            they scroll off with it. */}
        <div className="sticky top-[calc(var(--app-header-shift)+1rem)] z-20">
          <TeamsToolbar
            search={search}
            setSearch={setSearch}
            onOpenFilters={isWide ? undefined : () => setFiltersOpen(true)}
            controlsElsewhere={isMobile && !isWide}
          />
        </div>
        <TeamsActiveFilters
          search={search}
          setSearch={setSearch}
          count={isLoading ? null : total}
        />

        {isLoading ? (
          <DirectorySkeleton />
        ) : teams.length === 0 ? (
          <DirectoryEmptyState
            filtered={isFiltered}
            onClear={() => setSearch(CLEARED_TEAM_FILTERS)}
            onStart={startTeam}
          />
        ) : (
          // Same construction as the member directory: rows near the
          // viewport are the only ones mounted, and the paging sentinel
          // lives in the footer so it survives virtualization.
          <VirtualGrid
            items={teams}
            getItemKey={(team) => team.id}
            renderItem={(team) => <TeamDirectoryCard team={team} />}
            rowClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            estimateRowHeight={CARD_ROW_ESTIMATE}
            footer={
              hasNextPage ? (
                <div ref={sentinelRef} className="py-4">
                  {isFetchingNextPage ? <DirectorySkeleton count={3} /> : null}
                </div>
              ) : null
            }
          />
        )}
      </motion.section>

      {isMobile && !isWide ? (
        <TeamsFloatingControls
          search={search}
          setSearch={setSearch}
          onOpenFilters={() => setFiltersOpen(true)}
        />
      ) : null}

      <TeamCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Same drawer idiom as the collab board's filters — one overlay on
          mobile, dismissed the same way (swipe, scrim, or the panel's own
          CTA). */}
      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent className="max-h-[88vh] p-0">
          <DrawerDescription className="sr-only">
            Narrow the directory by recruiting status, shipped work, tech stack, and sort order.
          </DrawerDescription>
          <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 py-3 pr-3 pl-5">
              <DrawerTitle className="text-base tracking-widest text-foreground uppercase">
                Filters
              </DrawerTitle>
              <TeamsFilterClearButton search={search} setSearch={setSearch} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <TeamsFilterPanel
                search={search}
                setSearch={setSearch}
                resultCount={isLoading ? null : total}
                onDone={() => setFiltersOpen(false)}
              />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </PageStack>
  );
}

/**
 * The page's masthead and primary action. Signed-out visitors get the
 * same button pointed at sign-in rather than a hidden one — the ask is
 * the point of the banner, and hiding it makes the page look read-only.
 */
function TeamsHero({ authenticated, onStart }: { authenticated: boolean; onStart: () => void }) {
  return (
    <Well
      notchOpts
      // The gradient is the surface's alone. The notched corners fall outside
      // its clip path, and `Well` fills what's left with the frame's own
      // lighter face — carrying the wash out there instead reads as a second,
      // dimmer panel behind the first.
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      {/* Heaviest behind the headline's shoulder, gone by the time it
          reaches the copy. */}
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
        <div className="flex max-w-prose min-w-64 flex-col gap-2">
          <MicroLabel>TEAM DIRECTORY</MicroLabel>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            Find a crew to build with
          </Heading>
          <Text size="sm" variant="muted">
            Browse teams that are recruiting, see what they've shipped and what they work in — or
            start your own page and let people come to you.
          </Text>
        </div>
        <Button size="lg" onClick={onStart} className="tracking-widest">
          <HugeiconsIcon icon={authenticated ? Add01Icon : Login01Icon} size={14} />
          {authenticated ? "START A TEAM" : "SIGN IN TO START A TEAM"}
        </Button>
      </div>
    </Well>
  );
}

/**
 * The viewer's own teams, above the directory. Renders its own empty
 * state rather than disappearing: a signed-in member with no team is
 * exactly who the create path is for.
 */
function YourTeamsShelf({ onStart }: { onStart: () => void }) {
  const { data: myTeams, isLoading } = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    staleTime: 60 * 1000,
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-dashed border-muted-foreground/25 pb-1.5">
        <MicroLabel>YOUR TEAMS</MicroLabel>
        {myTeams && myTeams.length > 0 ? (
          <Text as="span" size="xs" variant="muted" className="tabular-nums">
            {myTeams.length}
          </Text>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-42 w-full" />
          ))}
        </div>
      ) : (myTeams?.length ?? 0) === 0 ? (
        <Well
          variant="ghost"
          className="flex-row flex-wrap items-center justify-between gap-3 bg-card p-4 backdrop-blur-none"
        >
          <div className="flex items-center gap-3">
            <HugeiconsIcon icon={UserGroupIcon} size={18} className="text-muted-foreground" />
            <Text size="sm" variant="muted">
              You're not on a team yet — start one, or ask to join a crew below.
            </Text>
          </div>
          <Button variant="outline" size="sm" onClick={onStart} className="tracking-widest">
            <HugeiconsIcon icon={Add01Icon} size={12} />
            START A TEAM
          </Button>
        </Well>
      ) : (
        /* The same tile as the directory below, plus the viewer's role — a
           team you belong to shouldn't look like a different kind of object
           from the same team seen in the listing. */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {myTeams!.map((team) => (
            <TeamDirectoryCard key={team.id} team={team} role={team.role} />
          ))}
        </div>
      )}
    </section>
  );
}

/** An over-filtered directory and an empty one are different problems. */
function DirectoryEmptyState({
  filtered,
  onClear,
  onStart,
}: {
  filtered: boolean;
  onClear: () => void;
  onStart: () => void;
}) {
  return (
    <Well className="items-center justify-center gap-3 bg-card px-4 py-12 text-center backdrop-blur-none">
      <Text variant="muted" className="text-4xl opacity-40">
        [ ]
      </Text>
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        {filtered ? "No teams match your filters" : "No teams yet — start the first one"}
      </Text>
      <Button
        variant="outline"
        size="sm"
        onClick={filtered ? onClear : onStart}
        className="tracking-widest"
      >
        {filtered ? "CLEAR ALL FILTERS" : "START A TEAM"}
      </Button>
    </Well>
  );
}

function DirectorySkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-42 w-full" />
      ))}
    </div>
  );
}
