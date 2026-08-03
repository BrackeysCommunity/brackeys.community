import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Kbd } from "@/components/ui/kbd";
import { Text } from "@/components/ui/typography";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import {
  beginWizardCreate,
  collabStore,
  resetWizard,
  setCollabFilters,
  updateWizardDraft,
} from "@/lib/collab-store";

import { CollabActiveFilters } from "./CollabActiveFilters";
import { CollabCreateFlyout } from "./CollabCreateFlyout";
import { CollabFilterClearButton, CollabFilterPanel } from "./CollabFilterPanel";
import { CollabInspector } from "./CollabInspector";
import { CollabPostFeed } from "./CollabPostFeed";
import { CollabPostPopover } from "./CollabPostPopover";
import { COLLAB_SEARCH_INPUT_ID, CollabToolbar } from "./CollabToolbar";
import { useCollabListing } from "./use-collab-listing";
import { useReleaseFocusOnOpen } from "./use-release-focus";

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
 * Top-level collab browser, laid out as a split view: a fixed-width
 * list lane on the left, a persistent inspector on the right. Selecting
 * a post loads it into the inspector rather than over the board, so you
 * can walk the list and compare without losing your place.
 *
 * Below `lg` there isn't room for two panes, so the lane becomes the
 * whole page and the same detail renders in an overlay instead.
 */
export function CollabBrowsePage() {
  const { session, isPending } = useStore(authStore);
  const navigate = useNavigate();
  const search = (useSearch({ strict: false }) as CollabSearch) ?? {};
  const isSplit = useIsSplitView();

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
  //   `P`      toggles between the projects ↔ people listing
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
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        const next = collabStore.state.filters.listingType === "people" ? "posts" : "people";
        setCollabFilters({ listingType: next });
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
  const lane = (
    <>
      <CollabToolbar
        onOpenFilters={isSplit ? undefined : () => setFiltersOpen(true)}
        authenticated={!!session?.user}
        onCreate={handleCreate}
      />
      <CollabActiveFilters />
    </>
  );

  return (
    <div className="flex flex-col gap-5 selection:bg-primary selection:text-white">
      {isSplit ? (
        <>
          {/* The region is viewport-height so each pane scrolls on its
              own — the lane keeps its scroll position while you walk
              posts, which is the whole point of the layout. */}
          <div className="grid h-[calc(100vh-15rem)] min-h-130 grid-cols-[minmax(0,1fr)_minmax(360px,360px)] gap-6">
            <section className="flex min-h-0 flex-col gap-3">
              {lane}
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <CollabPostFeed
                  currentUserId={currentUserId}
                  selectedPostId={selectedPostId}
                  onSelectPost={selectPost}
                />
              </div>
            </section>

            <aside className="flex min-h-0 flex-col">
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
              Press <Kbd>P</Kbd> to toggle people view.
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
