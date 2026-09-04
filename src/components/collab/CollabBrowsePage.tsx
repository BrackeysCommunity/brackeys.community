import { Add01Icon, Login01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Kbd } from "@/components/ui/kbd";
import { PageStack } from "@/components/ui/page-motion";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { beginWizardCreate, collabStore, resetWizard, updateWizardDraft } from "@/lib/collab-store";
import { useIsHydrated } from "@/lib/hooks/use-is-hydrated";
import { useLaneRelease } from "@/lib/hooks/use-lane-release";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useReleaseFocusOnOpen } from "@/lib/hooks/use-release-focus";
import { fadeIn, fadeUp } from "@/lib/motion";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import { type CollabBoardSearch } from "./collab-filters";
import { CollabActiveFilters } from "./CollabActiveFilters";
import { CollabCreateFlyout, type CollabCreateSurface } from "./CollabCreateFlyout";
import { CollabFilterClearButton, CollabFilterPanel } from "./CollabFilterPanel";
import { CollabPostFeed, CollabPostFeedStatic } from "./CollabPostFeed";
import { COLLAB_SEARCH_INPUT_ID, CollabFloatingControls, CollabToolbar } from "./CollabToolbar";
import { useCollabListing } from "./use-collab-listing";

/** The `lg` breakpoint, above which the toolbar carries the filters inline. */
const WIDE_QUERY = "(min-width: 1024px)";

function subscribeToWide(onChange: () => void) {
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Whether the toolbar has room for its filter menus inline. Picked in JS
 * rather than with `lg:` visibility classes because the narrow layout
 * mounts a filter sheet the wide one never does.
 */
function useIsWide() {
  return useSyncExternalStore(
    subscribeToWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

/**
 * Top-level collab browser: the toolbar, the active-filter readout, and
 * the list lane. Every card is a link to the post's own page — the board
 * is for scanning, the page is for reading and acting.
 *
 * The lane grows the page — scrolling is the page's, not a nested
 * scroller's.
 */
export function CollabBrowsePage() {
  const { session, isPending } = useStore(authStore);
  const navigate = useNavigate();
  const search = (useSearch({ strict: false }) as CollabBoardSearch) ?? {};
  const isWide = useIsWide();
  const isHydrated = useIsHydrated();
  // Keyed on the shell's breakpoint, not this board's: the floating controls
  // sit above the bottom nav island, which only the mobile shell mounts.
  // Between the two the board is stacked with its controls inline.
  const isMobile = useIsMobile();

  const [createOpen, setCreateOpen] = useState(false);
  const [createSurface, setCreateSurface] = useState<CollabCreateSurface>("quick");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useReleaseFocusOnOpen(filtersOpen);

  // A callback ref rather than a `useRef`: the two layouts each mount their
  // own toolbar, so switching between them has to re-measure.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const laneRelease = useLaneRelease(toolbarEl);

  const currentUserId = session?.user?.id ?? null;

  // Same query the lane renders, deduped by react-query — gives the page
  // the items for the pre-hydration static feed.
  const { items } = useCollabListing(currentUserId);

  // Open the create flyout when arriving via /collab/new (which
  // redirects here with `?new=1`), or via a jam's "FIND A TEAM" CTA
  // (`?new=1&jam=<id>`), which additionally preselects that jam. After
  // consuming the flags we strip them from the URL so back-navigation
  // doesn't loop — with `new`, `jam`/`team`/`project` mean "preselect",
  // not "filter", so they're consumed too. Everything else in the search
  // (the board's filters) survives.
  //
  // The split is deliberate: opening is local state adjusted during render off
  // a routing input, while seeding the wizard store and rewriting the URL are
  // writes to systems outside React and stay in the effect (`beginWizardCreate`
  // is explicitly not render-safe — other mounts subscribe to that store).
  // Comparing against the flag's last-seen value re-arms both halves, so a
  // second arrival at `?new=1` reopens the flyout.
  const jamForNewPost = search.new ? search.jam : undefined;
  const teamForNewPost = search.new ? search.team : undefined;
  const projectForNewPost = search.new ? search.project : undefined;
  const flowForNewPost = search.new ? search.flow : undefined;
  const newFlag = Boolean(search.new);
  const [newFlagSeen, setNewFlagSeen] = useState(false);
  if (newFlag !== newFlagSeen) {
    setNewFlagSeen(newFlag);
    if (newFlag) {
      setCreateSurface(flowForNewPost === "wizard" ? "wizard" : "quick");
      setCreateOpen(true);
    }
  }
  useEffect(() => {
    if (!search.new) return;
    beginWizardCreate();
    if (jamForNewPost !== undefined) updateWizardDraft({ jamId: jamForNewPost });
    // A team-page or project-page entrance arrives pre-linked (§8.4) —
    // `isIndividual: false` because a pre-linked team post can't be solo,
    // and a restored draft's switch state shouldn't override the entrance.
    if (teamForNewPost !== undefined) {
      updateWizardDraft({ teamId: teamForNewPost, isIndividual: false });
    }
    if (projectForNewPost !== undefined) {
      updateWizardDraft({ projectId: projectForNewPost });
    }
    navigate({
      from: "/collab/",
      search: (prev) => ({
        ...prev,
        new: undefined,
        flow: undefined,
        jam: undefined,
        team: undefined,
        project: undefined,
      }),
      replace: true,
      resetScroll: false,
    });
  }, [search.new, jamForNewPost, teamForNewPost, projectForNewPost, navigate]);

  // `/` focuses the lane's search input — skipped while typing in an
  // input, textarea, or contenteditable so it doesn't hijack normal keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true
      ) {
        return;
      }
      e.preventDefault();
      document.getElementById(COLLAB_SEARCH_INPUT_ID)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleCreate = () => {
    if (!isPending && !session?.user) {
      signInWithDiscord("collab_browse");
      return;
    }
    // A fresh post, not a continuation of an edit the user backed out
    // of — but any unfinished draft of their own comes back.
    beginWizardCreate();
    setCreateSurface("quick");
    setCreateOpen(true);
  };

  return (
    <PageStack className="flex flex-col gap-5 selection:bg-primary selection:text-white">
      <motion.div variants={fadeUp}>
        <CollabHero authenticated={!!session?.user} onCreate={handleCreate} />
      </motion.div>
      {/* The interactive board waits for hydration rather than rendering
          off `isWide` directly. That hook can't know the viewport on the
          server, so it reports narrow every time and a desktop load would
          paint the sheet-style toolbar, then swap it for the inline one —
          the toolbar and the lane's measured overhang both changing at
          once, which reads as the page rendering twice.

          The *posts* don't wait: the loader prefetches the first page, so
          the server document carries it as a plain static grid — that is
          what a crawler (or a no-JS reader) gets instead of an empty
          shell. The swap to the real board happens right after hydration,
          while every child of the stack is still held at opacity 0 for
          its first 250ms, so the static frame is never on screen.

          One tagged wrapper around both branches, too: a tag inside each
          would remount on the swap and inherit this stack's `hidden`
          initial, fading the body in a second time.

          `fadeIn` rather than `fadeUp` because the lane's toolbar is
          sticky — see the variant's own note. */}
      <motion.div variants={fadeIn} className="flex flex-col gap-5">
        {!isHydrated ? (
          <CollabPostFeedStatic items={items} />
        ) : (
          <div className="flex flex-col gap-3">
            {/* The controls pin under the app header and ride with it
                (`.header-follow`), carrying its surface so the list passes
                behind an opaque band. */}
            <div
              ref={setToolbarEl}
              data-cursor-occlude=""
              className="header-follow toolbar-band sticky top-0 z-20"
              style={{ marginBottom: laneRelease }}
            >
              <CollabToolbar
                onOpenFilters={isWide ? undefined : () => setFiltersOpen(true)}
                controlsElsewhere={isMobile}
              />
            </div>
            {/* A wrapper rather than the readout itself: the margin the
                overhang gives back has to land whatever the readout renders. */}
            <div style={{ marginTop: -laneRelease }}>
              <CollabActiveFilters />
            </div>
            <CollabPostFeed currentUserId={currentUserId} />
            {isWide ? (
              <Text size="sm" variant="muted" className="flex items-center gap-1.5">
                Press <Kbd>/</Kbd> to search.
              </Text>
            ) : null}
          </div>
        )}
      </motion.div>

      {isMobile && !isWide ? (
        <CollabFloatingControls onOpenFilters={() => setFiltersOpen(true)} />
      ) : null}

      <CollabCreateFlyout
        open={createOpen}
        surface={createSurface}
        onClose={() => {
          setCreateOpen(false);
          // Backing out of an edit must not leave the store primed to
          // overwrite that post the next time someone hits POST A GIG.
          if (collabStore.state.wizard.editingPostId !== null) resetWizard();
        }}
        // A new post lands on its own page, where the STRENGTHEN panel is.
        onCreated={(postId) =>
          navigate({ to: "/collab/$postId", params: { postId: String(postId) } })
        }
      />

      {/* Same drawer as the create flyout — one overlay idiom on mobile,
          dismissed the same way (swipe, scrim, or the panel's own CTA). */}
      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent className="max-h-[88vh] p-0">
          <DrawerDescription className="sr-only">
            Narrow the board by type, status, experience level, and sort order.
          </DrawerDescription>
          <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 py-3 pr-3 pl-5">
              <DrawerTitle className="text-base tracking-widest text-foreground uppercase">
                Filters
              </DrawerTitle>
              <CollabFilterClearButton />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <CollabFilterPanel onDone={() => setFiltersOpen(false)} />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </PageStack>
  );
}

/**
 * The board's masthead and primary action, built on the same frame as
 * the team directory's hero so the two boards read as one product.
 *
 * Signed-out visitors get the same button pointed at sign-in rather than
 * a hidden one — the ask is the point of the banner, and hiding it makes
 * the page look read-only.
 */
function CollabHero({ authenticated, onCreate }: { authenticated: boolean; onCreate: () => void }) {
  // A crew is the thing most posts want behind them, so the second CTA
  // only appears for someone who hasn't got one yet.
  const { data: myTeams } = useQuery({
    ...orpc.listMyTeams.queryOptions({ input: {} }),
    enabled: authenticated,
    staleTime: STALE.listing,
  });
  const needsTeam = authenticated && myTeams !== undefined && myTeams.length === 0;

  return (
    <Well
      // Keeps the app bar pinned until you scroll past — see `useHideOnScrollDown`.
      data-header-hero
      notchOpts
      // The gradient is the surface's alone — see the team hero for why
      // it can't ride on the frame.
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
        <div className="flex max-w-prose min-w-64 flex-col gap-2">
          <MicroLabel>COLLAB BOARD</MicroLabel>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            Find people to build with
          </Heading>
          <Text size="sm" variant="muted">
            Open roles from teams and solo devs — paid work and hobby projects. Post what you need
            filled, or answer someone who's already building.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {needsTeam ? (
            <Button
              variant="outline"
              size="lg"
              nativeButton={false}
              render={<Link to="/teams" search={{ new: true }} />}
              className="tracking-widest"
            >
              <HugeiconsIcon icon={UserGroupIcon} size={14} />
              START A TEAM
            </Button>
          ) : null}
          <Button size="lg" onClick={onCreate} className="tracking-widest">
            <HugeiconsIcon icon={authenticated ? Add01Icon : Login01Icon} size={14} />
            {authenticated ? "POST A ROLE" : "SIGN IN TO POST"}
          </Button>
        </div>
      </div>
    </Well>
  );
}
