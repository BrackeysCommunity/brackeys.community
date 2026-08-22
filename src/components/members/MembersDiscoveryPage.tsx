import { Login01Icon, UserSearch01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DirectorySkeleton } from "@/components/common/DirectorySkeleton";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { GraphPaper } from "@/components/ui/graph-paper";
import { PageStack } from "@/components/ui/page-motion";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { VirtualGrid } from "@/components/ui/virtual-grid";
import { Well } from "@/components/ui/well";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { useInfiniteScrollSentinel } from "@/lib/hooks/use-infinite-scroll-sentinel";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useMyProfileParams } from "@/lib/hooks/use-my-profile-params";
import { useReleaseFocusOnOpen } from "@/lib/hooks/use-release-focus";
import { useSearchPerformed } from "@/lib/hooks/use-search-performed";
import { fadeIn, fadeUp } from "@/lib/motion";

import { ActiveMembersRail } from "./ActiveMembersRail";
import { MemberDirectoryCard } from "./MemberDirectoryCard";
import { CLEARED_MEMBER_FILTERS, memberFilterKinds, type MembersSearch } from "./members-filters";
import { MembersActiveFilters } from "./MembersActiveFilters";
import { MembersFilterClearButton, MembersFilterPanel } from "./MembersFilterPanel";
import { MembersFloatingControls, MembersToolbar } from "./MembersToolbar";
import { membersListQueryOptions } from "./use-members-listing";

export type { MembersSearch, MembersSort } from "./members-filters";

/** Directory tile height before a real row is measured — the skeleton's
 * `h-42`, which is what an average filled-in card comes out at. */
const CARD_ROW_ESTIMATE = 168;

/** Above this the toggle row fits inline; below it, it moves to the sheet. */
const WIDE_QUERY = "(min-width: 1024px)";

/**
 * `/members` — the people directory, the team directory's counterpart.
 * Browsing comes first: a visitor without an account should see who is
 * here, not a sign-in wall. The most-active rail rides above the listing
 * as a shortlist, so "who's actually building right now" is answerable
 * without touching a filter.
 *
 * Filters live in the URL (`?q=&skills=&availability=&open=&rate=&sort=`)
 * so a narrowed directory is shareable, matching the other two boards.
 *
 * Everyone with a profile is listed rather than only the filled-in ones:
 * the count has to be the truth about the community. The default
 * most-active ordering is what keeps the empty profiles off the front,
 * and it does so without lying about how many there are.
 */
export function MembersDiscoveryPage() {
  const { session } = useStore(authStore);
  const myProfileParams = useMyProfileParams(session?.user?.id);
  const navigate = useNavigate();
  const search = (useSearch({ strict: false }) as MembersSearch) ?? {};

  // The toggle row fits inline on a wide screen; below that it moves into
  // the filter sheet. Two separate thresholds: the floating controls sit
  // above the bottom nav island, which only the mobile shell mounts, so
  // they follow the shell's breakpoint rather than this page's wider one.
  // In between, the sheet is there with its trigger inline.
  const isWide = useMediaQuery(WIDE_QUERY);
  const isMobile = useIsMobile();

  const [filtersOpen, setFiltersOpen] = useState(false);
  useReleaseFocusOnOpen(filtersOpen);

  // The current search, read through a ref so the writer below can stay
  // referentially stable — the debounced search box keys its timer on the
  // value it's given, and a writer rebuilt every render would restart it.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });

  // Merged here rather than through the router's `(prev) => …` reducer:
  // `prev` is typed as the search union of every route, so `sort` comes
  // back as this route's values *plus* the collab and team boards' — and
  // the widened union isn't assignable to `/members`. This page owns its
  // whole search object, so it can just write it.
  const setSearch = useCallback(
    (next: Partial<MembersSearch>) => {
      void navigate({
        to: "/members",
        search: { ...searchRef.current, ...next },
        replace: true,
      });
    },
    [navigate],
  );

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery(
    membersListQueryOptions(search),
  );

  const members = useMemo(() => data?.pages.flatMap((p) => p.members) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;

  useSearchPerformed({
    surface: "members",
    query: search.q,
    filterKinds: memberFilterKinds(search),
    resultCount: isLoading ? null : total,
  });

  const sentinelRef = useInfiniteScrollSentinel({
    hasNextPage,
    isFetching: isFetchingNextPage,
    fetchNext: fetchNextPage,
  });

  return (
    <PageStack className="flex flex-col gap-8 selection:bg-primary selection:text-white">
      <motion.div variants={fadeUp}>
        <MembersHero myProfileParams={myProfileParams} />
      </motion.div>

      <motion.div variants={fadeUp}>
        <ActiveMembersRail />
      </motion.div>

      {/* `fadeIn`, not `fadeUp`: the toolbar below is sticky, and a
          transform on its ancestor makes it jump when the rise ends. */}
      <motion.section variants={fadeIn} className="flex flex-col gap-3">
        {/* Same construction as the team directory's — see the comment there. */}
        <div data-cursor-occlude="" className="header-follow-inset toolbar-band sticky z-20">
          <MembersToolbar
            search={search}
            setSearch={setSearch}
            onOpenFilters={isWide ? undefined : () => setFiltersOpen(true)}
            controlsElsewhere={isMobile && !isWide}
          />
        </div>
        <MembersActiveFilters
          search={search}
          setSearch={setSearch}
          count={isLoading ? null : total}
        />

        {isLoading ? (
          <DirectorySkeleton />
        ) : members.length === 0 ? (
          <DirectoryEmptyState onClear={() => setSearch(CLEARED_MEMBER_FILTERS)} />
        ) : (
          // Virtualized: the directory pages in 24 at a time and never
          // drops what it has, so a long browse otherwise leaves every
          // card — and every avatar — mounted behind you. The paging
          // sentinel sits in the footer, outside the virtualized rows,
          // so it can't be unmounted at the moment it has to fire.
          <VirtualGrid
            items={members}
            getItemKey={(member) => member.id}
            renderItem={(member) => <MemberDirectoryCard member={member} />}
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
        <MembersFloatingControls
          search={search}
          setSearch={setSearch}
          onOpenFilters={() => setFiltersOpen(true)}
        />
      ) : null}

      {/* Same drawer idiom as the team directory's filters — one overlay on
          mobile, dismissed the same way (swipe, scrim, or the panel's own
          CTA). */}
      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent className="max-h-[88vh] p-0">
          <DrawerDescription className="sr-only">
            Narrow the directory by availability, hourly rate, skills, and sort order.
          </DrawerDescription>
          <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 py-3 pr-3 pl-5">
              <DrawerTitle className="text-base tracking-widest text-foreground uppercase">
                Filters
              </DrawerTitle>
              <MembersFilterClearButton search={search} setSearch={setSearch} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <MembersFilterPanel
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
 * The page's masthead. Unlike the team directory there's nothing to
 * create here — a member is a person, not a page you start — so the
 * action is "make yourself findable": the profile builder for a signed-in
 * visitor, sign-in for everyone else.
 */
function MembersHero({ myProfileParams }: { myProfileParams: { userId: string } | null }) {
  return (
    <Well
      data-header-hero
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
          <MicroLabel>MEMBER DIRECTORY</MicroLabel>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            Find the people behind the games
          </Heading>
          <Text size="sm" variant="muted">
            Browse everyone building here — what they work in, what they've shipped, and who's open
            to work right now.
          </Text>
        </div>
        {myProfileParams ? (
          <Button
            size="lg"
            nativeButton={false}
            render={<Link to="/profile/$userId" params={myProfileParams} />}
            className="tracking-widest"
          >
            <HugeiconsIcon icon={UserSearch01Icon} size={14} />
            MAKE YOURSELF FINDABLE
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={() => signInWithDiscord("members_discovery")}
            className="tracking-widest"
          >
            <HugeiconsIcon icon={Login01Icon} size={14} />
            SIGN IN TO BE LISTED
          </Button>
        )}
      </div>
    </Well>
  );
}

/**
 * There is no unfiltered empty state worth writing: a directory of people
 * is never empty while someone is reading it, so the only way here is
 * over-filtering.
 */
function DirectoryEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <Well className="items-center justify-center gap-3 bg-card px-4 py-12 text-center backdrop-blur-none">
      <Text variant="muted" className="text-4xl opacity-40">
        [ ]
      </Text>
      <Text size="xs" variant="muted" className="tracking-widest uppercase">
        No members match your filters
      </Text>
      <Button variant="outline" size="sm" onClick={onClear} className="tracking-widest">
        CLEAR ALL FILTERS
      </Button>
    </Well>
  );
}
