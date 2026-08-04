import { Add01Icon, Login01Icon, UserGroupIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Kbd } from "@/components/ui/kbd";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { useReleaseFocusOnOpen } from "@/hooks/use-release-focus";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import {
  beginWizardCreate,
  collabStore,
  resetWizard,
  setCollabFilters,
  updateWizardDraft,
} from "@/lib/collab-store";
import { orpc } from "@/orpc/client";

import { CollabActiveFilters } from "./CollabActiveFilters";
import { CollabCreateFlyout } from "./CollabCreateFlyout";
import { CollabFilterClearButton, CollabFilterPanel } from "./CollabFilterPanel";
import { CollabInspector } from "./CollabInspector";
import { CollabPostFeed } from "./CollabPostFeed";
import { CollabPostPopover } from "./CollabPostPopover";
import { COLLAB_SEARCH_INPUT_ID, CollabFloatingControls, CollabToolbar } from "./CollabToolbar";
import { useCollabListing } from "./use-collab-listing";

interface CollabSearch {
  new?: boolean;
  /** The selected post. Drives the inspector pane on desktop and the
   *  detail overlay on narrow screens, so selection is shareable. */
  post?: number;
  /** With `new`: the jam to preselect in the wizard. On its own: the
   *  jam the board is filtered to. */
  jam?: number;
  /** Tech-stack filter, so a narrowed board is shareable. */
  skills?: number[];
  /** One team's posts — set by a team page's "see all" link. */
  team?: string;
}

/** Matches the `lg` breakpoint that switches the board to two panes. */
const SPLIT_QUERY = "(min-width: 1024px)";

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
  const search = (useSearch({ strict: false }) as CollabSearch) ?? {};
  const isSplit = useIsSplitView();
  // Keyed on the shell, not the breakpoint: the floating controls sit above
  // the bottom nav island, which only the touch shell mounts. A narrow desktop
  // window gets the same stacked board with the controls inline.
  const isTouch = useIsTouchDevice();

  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  useReleaseFocusOnOpen(filtersOpen);

  const currentUserId = session?.user?.id ?? null;
  const selectedPostId = typeof search.post === "number" ? search.post : null;

  // Same query the lane renders, deduped by react-query — gives the
  // page the ordered ids that arrow-key selection walks through.
  const { postIds } = useCollabListing(currentUserId);

  // Open the create flyout when arriving via /collab/new (which
  // redirects here with `?new=1`), or via a jam's "FIND A TEAM" CTA
  // (`?new=1&jam=<id>`), which additionally preselects that jam. After
  // consuming the flags we strip them from the URL so back-navigation
  // doesn't loop — `jam` means "preselect", not "filter", in this pair.
  const jamForNewPost = search.new ? search.jam : undefined;
  useEffect(() => {
    if (!search.new) return;
    beginWizardCreate();
    if (jamForNewPost !== undefined) updateWizardDraft({ jamId: jamForNewPost });
    setCreateOpen(true);
    navigate({ to: "/collab", search: {}, replace: true });
  }, [search.new, jamForNewPost, navigate]);

  // Board filters that live in the URL are read once, on arrival; from
  // then on the store owns them and pushes back (below). Skipped when
  // `new` is present, where `jam` addresses the wizard instead.
  const hydratedFromUrl = useRef(false);
  useEffect(() => {
    if (hydratedFromUrl.current || search.new) return;
    hydratedFromUrl.current = true;
    if (search.jam !== undefined || search.team !== undefined || (search.skills?.length ?? 0) > 0) {
      setCollabFilters({ jamId: search.jam, teamId: search.team, skillIds: search.skills ?? [] });
    }
  }, [search.new, search.jam, search.team, search.skills]);

  // …and the reverse: filter changes rewrite the URL so any narrowed
  // board can be linked. `replace` because filtering is refinement, not
  // navigation — Back should leave the board, not undo one chip.
  const jamFilter = useStore(collabStore, (s) => s.filters.jamId);
  const teamFilter = useStore(collabStore, (s) => s.filters.teamId);
  const skillFilters = useStore(collabStore, (s) => s.filters.skillIds);
  useEffect(() => {
    if (!hydratedFromUrl.current) return;
    navigate({
      to: "/collab",
      search: (prev: CollabSearch) => ({
        ...prev,
        jam: jamFilter,
        team: teamFilter,
        skills: skillFilters.length > 0 ? skillFilters : undefined,
      }),
      replace: true,
    });
  }, [jamFilter, teamFilter, skillFilters, navigate]);

  // Selection lives in the URL so it survives reload, back/forward, and
  // sharing. Clicking pushes (back returns to the idle pane); walking
  // with the arrows replaces, so a long scan leaves one history entry.
  // Both preserve the rest of the search so selecting a post inside a
  // filtered board doesn't silently drop the filter.
  const selectPost = useCallback(
    (postId: number, replace = false) => {
      navigate({
        to: "/collab",
        search: (prev: CollabSearch) => ({ ...prev, post: postId }),
        replace,
      });
    },
    [navigate],
  );
  const clearSelection = useCallback(() => {
    navigate({
      to: "/collab",
      search: (prev: CollabSearch) => ({ ...prev, post: undefined }),
      replace: false,
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
      <div className="sticky top-[calc(var(--app-header-shift)+1rem)] z-20">
        <CollabToolbar
          onOpenFilters={isSplit ? undefined : () => setFiltersOpen(true)}
          controlsElsewhere={isTouch}
        />
      </div>
      <CollabActiveFilters />
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

      {isTouch && !isSplit ? (
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
      surfaceClassName="bg-card bg-linear-to-br from-primary/12 via-card to-card backdrop-blur-none"
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
