import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Text } from "@/components/ui/typography";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import { authClient } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import {
  collabStore,
  countActiveCollabFilters,
  resetCollabFilters,
  setCollabFilters,
} from "@/lib/collab-store";
import { client } from "@/orpc/client";

import { CollabCreateCta } from "./CollabCreateCta";
import { CollabCreateFlyout } from "./CollabCreateFlyout";
import { CollabFeaturedPerson } from "./CollabFeaturedPerson";
import { COLLAB_SEARCH_INPUT_ID, CollabFilterPanel } from "./CollabFilterPanel";
import { CollabHero } from "./CollabHero";
import { CollabHotSkills } from "./CollabHotSkills";
import { CollabListingToggle } from "./CollabListingToggle";
import { CollabMobilePostPrompt } from "./CollabMobilePostPrompt";
import { CollabMobileSearch } from "./CollabMobileSearch";
import { CollabPostFeed } from "./CollabPostFeed";
import { CollabPostPopover } from "./CollabPostPopover";
import { CollabPulse } from "./CollabPulse";
import { CollabQuickBoard } from "./CollabQuickBoard";
import { AddSectionAction, CollabSectionHeader } from "./CollabSectionHeader";

interface CollabSearch {
  new?: boolean;
  /** Drives the post detail popover — `?post=<id>` opens the popover
   *  on mount so direct links land on the right post. */
  post?: number;
}

// The right rail (PULSE / SKILLS / FEATURED) leans on data sources we
// don't have backends for yet (real-time post counts per hour, skill
// trend deltas, curated featured users). Keep it dark behind a local
// boolean until the underlying APIs land — flip to `true` here to
// preview the layout, or wire to an env / feature-flag service later.
const SHOW_RIGHT_RAIL = false;

/**
 * Top-level collab browser. Lays out a hero + quick board header, a
 * three-column body on desktop (filter rail / feed / right rail), and a
 * stacked single-column flow on mobile. The create flyout is owned at
 * this level so any of the CTAs can summon it.
 */
export function CollabBrowsePage() {
  const { session, isPending } = useStore(authStore);
  const isTouch = useIsTouchDevice();
  const navigate = useNavigate();
  const search = (useSearch({ strict: false }) as CollabSearch) ?? {};

  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters = useStore(collabStore, (s) => s.filters);
  const activeFilterCount = countActiveCollabFilters(filters);

  // Open the create flyout when arriving via /collab/new (which
  // redirects here with `?new=1`). After consuming the flag we strip
  // it from the URL so back-navigation doesn't loop.
  useEffect(() => {
    if (search.new) {
      setCreateOpen(true);
      navigate({ to: "/collab", search: {}, replace: true });
    }
  }, [search.new, navigate]);

  // Global keyboard shortcuts:
  //   `/`   focuses the filter search input
  //   `P`   toggles between the projects ↔ people listing
  // Both are skipped while the user is typing inside an input/textarea
  // or a contenteditable surface so they don't hijack normal typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const inEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true;
      if (inEditable) return;

      if (e.key === "/") {
        e.preventDefault();
        document.getElementById(COLLAB_SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        const next = collabStore.state.filters.listingType === "people" ? "posts" : "people";
        setCollabFilters({ listingType: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data: counts } = useQuery({
    queryKey: ["collabCounts"],
    queryFn: async () => {
      const [paid, hobby, playtest, mentor] = await Promise.all([
        client.listPosts({ type: "paid", status: "recruiting", limit: 1 }),
        client.listPosts({ type: "hobby", status: "recruiting", limit: 1 }),
        client.listPosts({ type: "playtest", status: "recruiting", limit: 1 }),
        client.listPosts({ type: "mentor", status: "recruiting", limit: 1 }),
      ]);
      return {
        paid: paid.total ?? 0,
        hobby: hobby.total ?? 0,
        playtest: playtest.total ?? 0,
        mentor: mentor.total ?? 0,
      };
    },
    staleTime: 30 * 1000,
  });

  const totalRoles =
    (counts?.paid ?? 0) + (counts?.hobby ?? 0) + (counts?.playtest ?? 0) + (counts?.mentor ?? 0);

  const handleCreate = () => {
    if (!isPending && !session?.user) {
      authClient.signIn.social({ provider: "discord" });
      return;
    }
    setCreateOpen(true);
  };

  // The post detail popover is driven entirely by the `?post=<id>`
  // search param so direct-links and back/forward navigation just work.
  // `openPost` writes to the URL; `closePost` strips the param.
  const openPost = (postId: number) => {
    navigate({ to: "/collab", search: { post: postId }, replace: false });
  };
  const closePost = () => {
    navigate({ to: "/collab", search: {}, replace: false });
  };
  const openPostId = typeof search.post === "number" ? search.post : null;

  return (
    <div className="flex flex-col gap-8 selection:bg-primary selection:text-white">
      {/* Hero + quick board */}
      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end lg:gap-10">
        <CollabHero />
        <CollabQuickBoard
          paid={counts?.paid ?? 0}
          hobby={counts?.hobby ?? 0}
          playtest={counts?.playtest ?? 0}
          mentor={counts?.mentor ?? 0}
          compact={isTouch}
        />
      </div>

      {/* Narrow viewport (mobile + thin desktop): single-column flow.
          Driven by `lg:hidden` rather than `isTouch` so a non-touch
          browser at < lg width still gets a usable layout instead of
          a blank page. */}
      <div className="flex flex-col gap-4 lg:hidden">
        <CollabMobilePostPrompt onClick={handleCreate} />
        <CollabMobileSearch onOpenFilters={() => setFiltersOpen(true)} />
        <CollabListingToggle priority="primary" />
        <CollabPostFeed currentUserId={session?.user?.id ?? null} onOpenPost={openPost} />
      </div>

      {/* Desktop: 3-column body composed of isolated sections — the
          right rail collapses out when its flag is off. */}
      <div
        className={
          SHOW_RIGHT_RAIL
            ? "hidden lg:grid lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,300px)] lg:gap-8"
            : "hidden lg:grid lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)] lg:gap-8"
        }
      >
        <section className="flex flex-col gap-5">
          {!isPending ? (
            <CollabCreateCta authenticated={!!session?.user} onClick={handleCreate} />
          ) : null}
          <CollabSectionHeader
            index="01"
            title="FILTERS"
            action={
              activeFilterCount > 0 ? (
                <>
                  <Text
                    as="span"
                    monospace
                    size="xs"
                    variant="muted"
                    className="tracking-widest tabular-nums"
                  >
                    {activeFilterCount} ACTIVE
                  </Text>
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label="Clear all filters"
                    onClick={resetCollabFilters}
                    className="font-mono"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={10} />
                  </Button>
                </>
              ) : null
            }
          />
          <CollabFilterPanel />
        </section>

        <section className="flex min-h-[60vh] flex-col gap-4">
          <CollabSectionHeader
            index="02"
            title="BOARD"
            action={<AddSectionAction onAdd={handleCreate} label="POST" />}
          />
          <CollabPostFeed currentUserId={session?.user?.id ?? null} onOpenPost={openPost} />
        </section>

        {SHOW_RIGHT_RAIL ? (
          <section className="flex flex-col gap-5">
            <CollabSectionHeader index="A" title="PULSE" />
            <CollabPulse posts={totalRoles} />
            <CollabSectionHeader index="B" title="SKILLS" />
            <CollabHotSkills />
            <CollabSectionHeader index="C" title="FEATURED" />
            <CollabFeaturedPerson />
          </section>
        ) : null}
      </div>

      <CollabCreateFlyout
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(postId) => {
          openPost(postId);
        }}
      />

      <CollabPostPopover
        postId={openPostId}
        currentUserId={session?.user?.id ?? null}
        onClose={closePost}
      />

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="font-mono tracking-widest uppercase">// FILTERS</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <CollabFilterPanel onDone={() => setFiltersOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
