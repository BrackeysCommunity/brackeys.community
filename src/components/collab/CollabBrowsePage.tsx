import { Add01Icon, Login01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Kbd } from "@/components/ui/kbd";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReleaseFocusOnOpen } from "@/hooks/use-release-focus";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { beginWizardCreate, collabStore, resetWizard, updateWizardDraft } from "@/lib/collab-store";
import { orpc } from "@/orpc/client";

import { type CollabBoardSearch } from "./collab-filters";
import { CollabActiveFilters } from "./CollabActiveFilters";
import { CollabCreateFlyout } from "./CollabCreateFlyout";
import { CollabFilterClearButton, CollabFilterPanel } from "./CollabFilterPanel";
import { CollabInspector } from "./CollabInspector";
import { CollabPostFeed } from "./CollabPostFeed";
import { CollabPostPopover } from "./CollabPostPopover";
import { COLLAB_SEARCH_INPUT_ID, CollabFloatingControls, CollabToolbar } from "./CollabToolbar";
import { useCollabListing } from "./use-collab-listing";

/** Matches the `lg` breakpoint that switches the board to two panes. */
const SPLIT_QUERY = "(min-width: 1024px)";

/**
 * How far the toolbar's margin box should overhang the bottom of its lane.
 *
 * A sticky box is held inside its containing block by its *margin* box, so
 * an overhang is what lets the lane release the bar before its own end: it
 * rides up and off with the last of the list instead of sitting pinned over
 * the footer for the rest of the scroll, which is what the inspector does
 * beside it (that one gets there for free by being a scrollport tall).
 *
 * The number is where the lane's end sits once the page has bottomed out:
 * the scrollport, less everything trailing the lane — the hint row and the
 * site footer. Overhang exactly that much and the bar's margin box lands
 * flush with the lane's end at the last pixel of scroll, which puts the bar
 * itself just above the top of the scrollport: gone, and not one pixel of
 * pinning given up before then. It slides off over the final stretch, the
 * same stretch the inspector uses. Zero means the lane already ends high
 * enough on its own, which is the old behaviour and the right one there.
 *
 * Measured rather than written in `dvh`: neither term is a constant. The
 * scrollport isn't the viewport on either shell (a header band inside one,
 * a nav island in the other), and the footer reflows with the width.
 *
 * Whoever renders the overhang hands the same distance straight back as a
 * negative top margin, so none of it takes up space in flow.
 */
function useLaneRelease(bar: HTMLElement | null) {
  const [release, setRelease] = useState(0);

  useEffect(() => {
    const scroller = bar?.closest<HTMLElement>("[data-scroll-root]");
    const lane = bar?.parentElement;
    if (!bar || !lane || !scroller) return;

    const measure = () => {
      const laneEnd =
        lane.getBoundingClientRect().bottom -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop;
      const belowLane = scroller.scrollHeight - laneEnd;
      setRelease(Math.max(0, scroller.clientHeight - belowLane));
    };

    measure();
    // Both terms move: the scrollport with the window, the footer with the
    // width. Neither is affected by the margin this feeds, so there's no
    // loop. The window listener is the belt to that braces — a scroller
    // sized by the viewport doesn't always report a resize of its own.
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    if (scroller.lastElementChild) observer.observe(scroller.lastElementChild);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [bar]);

  return release;
}

function subscribeToSplit(onChange: () => void) {
  const mql = window.matchMedia(SPLIT_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Whether the board has room for two panes. Picked in JS rather than
 * with `lg:` visibility classes because the two layouts differ in more
 * than visibility: only the split view mounts the inspector and answers
 * to arrow-key selection, and only the stacked one mounts the drawer.
 */
function useIsSplitView() {
  return useSyncExternalStore(
    subscribeToSplit,
    () => window.matchMedia(SPLIT_QUERY).matches,
    () => false,
  );
}

/**
 * Top-level collab browser, laid out as a split view: the list lane on
 * the left, a persistent inspector on the right. Selecting a post loads
 * it into the inspector rather than over the board, so you can walk the
 * list and compare without losing your place.
 *
 * The lane grows the page — scrolling is the page's, not a nested
 * scroller's — and the inspector sticks alongside it.
 *
 * Below `lg` there isn't room for two panes, so the lane becomes the
 * whole page and the same detail renders in an overlay instead.
 */
export function CollabBrowsePage() {
  const { session, isPending } = useStore(authStore);
  const navigate = useNavigate();
  const search = (useSearch({ strict: false }) as CollabBoardSearch) ?? {};
  const isSplit = useIsSplitView();
  // Keyed on the shell's breakpoint, not this board's: the floating controls
  // sit above the bottom nav island, which only the mobile shell mounts.
  // Between the two the board is stacked with its controls inline.
  const isMobile = useIsMobile();

  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useReleaseFocusOnOpen(filtersOpen);

  // A callback ref rather than a `useRef`: the two layouts each mount their
  // own toolbar, so switching between them has to re-measure.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const laneRelease = useLaneRelease(toolbarEl);

  const currentUserId = session?.user?.id ?? null;
  const selectedPostId = typeof search.post === "number" ? search.post : null;

  // Same query the lane renders, deduped by react-query — gives the
  // page the ordered ids that arrow-key selection walks through.
  const { postIds } = useCollabListing(currentUserId);

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
  const newFlag = Boolean(search.new);
  const [newFlagSeen, setNewFlagSeen] = useState(false);
  if (newFlag !== newFlagSeen) {
    setNewFlagSeen(newFlag);
    if (newFlag) setCreateOpen(true);
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
        jam: undefined,
        team: undefined,
        project: undefined,
      }),
      replace: true,
      resetScroll: false,
    });
  }, [search.new, jamForNewPost, teamForNewPost, projectForNewPost, navigate]);

  // Selection lives in the URL so it survives reload, back/forward, and
  // sharing. Clicking pushes (back returns to the idle pane); walking
  // with the arrows replaces, so a long scan leaves one history entry.
  // Both preserve the rest of the search so selecting a post inside a
  // filtered board doesn't silently drop the filter.
  //
  // `resetScroll: false` throughout: these write a URL, they don't
  // navigate anywhere. The board stays where it is and the inspector
  // changes beside it, so the router's scroll-to-top would throw away
  // the reader's place in the list on every click.
  const selectPost = useCallback(
    (postId: number, replace = false) => {
      navigate({
        from: "/collab/",
        search: (prev) => ({ ...prev, post: postId }),
        replace,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const clearSelection = useCallback(() => {
    navigate({
      from: "/collab/",
      search: (prev) => ({ ...prev, post: undefined }),
      replace: false,
      resetScroll: false,
    });
  }, [navigate]);

  // Global keyboard shortcuts:
  //   `/`      focuses the lane's search input
  //   `↑` `↓`  walk the selection through the lane (split view only)
  //   `Esc`    clears the selection
  // All are skipped while typing in an input, textarea, or
  // contenteditable so they don't hijack normal keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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

      if (e.key === "/") {
        e.preventDefault();
        document.getElementById(COLLAB_SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (e.key === "Escape" && selectedPostId !== null) {
        e.preventDefault();
        clearSelection();
        return;
      }
      // Arrow selection only makes sense where the inspector is visible;
      // on narrow screens it would fire an overlay on every keypress.
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && isSplit && postIds.length > 0) {
        e.preventDefault();
        const current = selectedPostId === null ? -1 : postIds.indexOf(selectedPostId);
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = current === -1 ? 0 : current + delta;
        if (next >= 0 && next < postIds.length) selectPost(postIds[next], true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSplit, postIds, selectedPostId, selectPost, clearSelection]);

  const handleCreate = () => {
    if (!isPending && !session?.user) {
      signInWithDiscord();
      return;
    }
    // A fresh post, not a continuation of an edit the user backed out
    // of — but any unfinished draft of their own comes back.
    beginWizardCreate();
    setCreateOpen(true);
  };

  // The board itself gets the full-width controls; only the narrow
  // stacked layout falls back to the filter sheet.
  // The controls pin to the top of the scrollport, just under the app header —
  // they're the one thing you always want reachable while walking a long list.
  // `--app-header-shift` takes them up into the band the header vacates and
  // back down when it returns, so they ride with it rather than leaving a gap.
  // The `+1rem` is a gutter they keep in both states — parked flush against
  // the viewport edge they read as clipped rather than pinned.
  // They carry no surface of their own: `z-20` lands them on top of the
  // header's fixed scrim, which is what the list dissolves into on its way
  // past. The count and chips are a readout of the board rather than a
  // control, so they scroll off with it.
  const lane = (
    <>
      <div
        ref={setToolbarEl}
        className="sticky top-[calc(var(--app-header-shift)+1rem)] z-20"
        style={{ marginBottom: laneRelease }}
      >
        <CollabToolbar
          onOpenFilters={isSplit ? undefined : () => setFiltersOpen(true)}
          controlsElsewhere={isMobile}
        />
      </div>
      {/* A wrapper rather than the readout itself: the margin the overhang
          gives back has to land whatever the readout renders. */}
      <div style={{ marginTop: -laneRelease }}>
        <CollabActiveFilters />
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-5 selection:bg-primary selection:text-white">
      <CollabHero authenticated={!!session?.user} onCreate={handleCreate} />
      {isSplit ? (
        <>
          {/* `items-start` is what lets the inspector stick: a stretched
              grid item is already as tall as the lane, so it would have
              nothing to travel through. */}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(360px,360px)] items-start gap-6">
            <section className="flex flex-col gap-3">
              {lane}
              <CollabPostFeed
                currentUserId={currentUserId}
                selectedPostId={selectedPostId}
                onSelectPost={selectPost}
              />
            </section>

            {/* Parked at the same inset as the toolbar so the two lanes line
                up along one edge, and travelling with the header — see
                `--app-header-shift`. The cap is a constant: the room the pane
                has when fully expanded — parked at its 1rem inset with the
                header away — plus a 1.5rem bottom gutter. Deliberately no
                `--app-header-shift` term: the header returning moves the
                pane's top (via `top`) and the bottom simply follows, hanging
                past the fold rather than compressing the pane. A long post
                detail scrolls inside it, while the idle readout stays short
                instead of stretching to fill the viewport. */}
            <aside className="sticky top-[calc(var(--app-header-shift)+1rem)] z-20 flex max-h-[calc(100vh-2.5rem)] flex-col">
              <CollabInspector
                postId={selectedPostId}
                currentUserId={currentUserId}
                onClose={clearSelection}
                onEdit={() => setCreateOpen(true)}
                compact
              />
            </aside>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Text size="sm" variant="muted" className="flex items-center gap-1.5">
              Press <Kbd>/</Kbd> to search.
            </Text>
            <Text size="sm" variant="muted" className="flex items-center gap-1.5">
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> to walk posts.
            </Text>
          </div>
        </>
      ) : (
        /* No room for two panes: the lane is the page, detail opens over it. */
        <div className="flex flex-col gap-3">
          {lane}
          <CollabPostFeed
            currentUserId={currentUserId}
            selectedPostId={selectedPostId}
            onSelectPost={selectPost}
          />
        </div>
      )}

      {isMobile && !isSplit ? (
        <CollabFloatingControls onOpenFilters={() => setFiltersOpen(true)} />
      ) : null}

      {/* Doubles as the edit surface: the detail panel seeds the wizard
          store, then flips this open. */}
      <CollabCreateFlyout
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          // Backing out of an edit must not leave the store primed to
          // overwrite that post the next time someone hits POST A GIG.
          if (collabStore.state.wizard.editingPostId !== null) resetWizard();
        }}
        onCreated={(postId) => selectPost(postId)}
      />

      {/* The drawer is the narrow-screen counterpart to the inspector,
          so it must not also mount behind the split view. */}
      {!isSplit ? (
        <CollabPostPopover
          postId={selectedPostId}
          currentUserId={currentUserId}
          onClose={clearSelection}
          onEdit={() => setCreateOpen(true)}
        />
      ) : null}

      {/* Same drawer as the post detail — one overlay idiom on mobile,
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
    </div>
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
    staleTime: 60 * 1000,
  });
  const needsTeam = authenticated && myTeams !== undefined && myTeams.length === 0;

  return (
    <Well
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
