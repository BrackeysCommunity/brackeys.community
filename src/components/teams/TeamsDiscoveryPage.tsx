import {
  Add01Icon,
  Login01Icon,
  SortByDown02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { signInWithDiscord } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { client, orpc } from "@/orpc/client";

import { TeamCreateDrawer } from "./TeamCreateDrawer";
import { TeamDirectoryCard } from "./TeamDirectoryCard";

const PAGE_SIZE = 24;

export type TeamsSort = "active" | "shipped" | "newest";

export interface TeamsSearch {
  q?: string;
  recruiting?: boolean;
  shipped?: boolean;
  skills?: number[];
  sort?: TeamsSort;
  /** Opens the create drawer on arrival — the entry point for deep links. */
  new?: boolean;
}

/**
 * Shared look for the filter row's toggles. The depressed-while-on state
 * comes from `.chonk-emboss[aria-pressed="true"]` in the stylesheet — the
 * classes here only carry the color, and are `!` so they beat the outline
 * variant's own hover background rather than depending on rule order.
 */
const FILTER_TOGGLE =
  "tracking-widest aria-pressed:border-primary! aria-pressed:bg-primary/15! aria-pressed:text-primary aria-pressed:[--emboss-shadow:var(--primary)]";

const SORT_OPTIONS: { value: TeamsSort; label: string }[] = [
  { value: "active", label: "RECRUITING FIRST" },
  { value: "shipped", label: "RECENTLY SHIPPED" },
  { value: "newest", label: "NEWEST" },
];

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

  const [createOpen, setCreateOpen] = useState(false);

  const sort = search.sort ?? "active";
  const skillIds = useMemo(() => search.skills ?? [], [search.skills]);

  const setSearch = (next: Partial<TeamsSearch>) => {
    void navigate({
      to: "/teams",
      search: (prev: TeamsSearch) => ({ ...prev, ...next }),
      replace: true,
    });
  };

  // `?new=1` is a one-shot: consume it so Back doesn't reopen the drawer.
  useEffect(() => {
    if (!search.new) return;
    setCreateOpen(true);
    void navigate({
      to: "/teams",
      search: (prev: TeamsSearch) => ({ ...prev, new: undefined }),
      replace: true,
    });
  }, [search.new, navigate]);

  const listInput = {
    search: search.q?.trim() || undefined,
    recruiting: search.recruiting || undefined,
    hasShipped: search.shipped || undefined,
    skillIds: skillIds.length > 0 ? skillIds : undefined,
    sort,
  };

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
  const isFiltered = Boolean(
    listInput.search || listInput.recruiting || listInput.hasShipped || skillIds.length > 0,
  );

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
    <div className="flex flex-col gap-8 selection:bg-primary selection:text-white">
      <TeamsHero authenticated={!!session?.user} onStart={startTeam} />

      {session?.user ? <YourTeamsShelf onStart={startTeam} /> : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <SearchField
              value={search.q ?? ""}
              onChange={(value) => setSearch({ q: value || undefined })}
              placeholder="Search teams by name or what they make…"
              autoComplete="off"
              size="default"
              containerClassName="h-10 min-w-0 flex-1 dark:bg-emboss-surface!"
              className="text-[11px] tracking-widest"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearch({ recruiting: search.recruiting ? undefined : true })}
              className={FILTER_TOGGLE}
              aria-pressed={!!search.recruiting}
            >
              RECRUITING
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearch({ shipped: search.shipped ? undefined : true })}
              className={FILTER_TOGGLE}
              aria-pressed={!!search.shipped}
            >
              HAS SHIPPED
            </Button>
            <StackFilterCombobox
              selected={skillIds}
              onChange={(next) => setSearch({ skills: next.length > 0 ? next : undefined })}
            />

            <div className="ml-auto flex items-center gap-2">
              <Text size="xs" variant="muted" className="tracking-widest uppercase tabular-nums">
                {isLoading ? "…" : `${total} ${total === 1 ? "team" : "teams"}`}
              </Text>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      title={`Sort: ${SORT_OPTIONS.find((o) => o.value === sort)!.label}`}
                      aria-label={`Sort order: ${SORT_OPTIONS.find((o) => o.value === sort)!.label}`}
                    />
                  }
                >
                  <HugeiconsIcon icon={SortByDown02Icon} size={14} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto min-w-48 p-1">
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(value) =>
                      setSearch({ sort: value === "active" ? undefined : (value as TeamsSort) })
                    }
                  >
                    {SORT_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem
                        key={option.value}
                        value={option.value}
                        closeOnClick
                        className="tracking-widest"
                      >
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {isLoading ? (
          <DirectorySkeleton />
        ) : teams.length === 0 ? (
          <DirectoryEmptyState
            filtered={isFiltered}
            onClear={() =>
              setSearch({
                q: undefined,
                recruiting: undefined,
                shipped: undefined,
                skills: undefined,
              })
            }
            onStart={startTeam}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {teams.map((team) => (
              <TeamDirectoryCard key={team.id} team={team} />
            ))}
            {hasNextPage ? (
              <div ref={sentinelRef} className="col-span-full flex justify-center py-4">
                {isFetchingNextPage ? (
                  <Text
                    size="xs"
                    variant="muted"
                    className="animate-pulse tracking-widest uppercase"
                  >
                    Loading more…
                  </Text>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <TeamCreateDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
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
      surfaceClassName="bg-card bg-linear-to-br from-primary/12 via-card to-card backdrop-blur-none"
    >
      {/* Graph paper, ruled and masked so it fades out toward the bottom
          left — heaviest behind the headline's shoulder, gone by the time
          it reaches the copy. Same ruling as the collab inspector's
          masthead. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-muted-foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--color-muted-foreground) 1px, transparent 1px)",
          backgroundSize: "18px 18px",
          opacity: 0.1,
          maskImage: "linear-gradient(to bottom left, #000 0%, transparent 85%)",
          WebkitMaskImage: "linear-gradient(to bottom left, #000 0%, transparent 85%)",
        }}
      />
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

/**
 * Stack filter. The roster's vocabulary runs to dozens of entries, which
 * is past the point where a checkbox menu is usable — so this is a combo
 * box: type to narrow, tick to select, ticks accumulate. The trigger
 * carries the same pressed treatment as the boolean filters beside it.
 */
function StackFilterCombobox({
  selected,
  onChange,
}: {
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const { data } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const skills = useMemo(() => data ?? [], [data]);
  const value = useMemo(
    () => skills.filter((skill) => selected.includes(skill.id)),
    [skills, selected],
  );

  if (skills.length === 0) return null;

  const label =
    value.length === 0
      ? "STACK"
      : value.length === 1
        ? value[0]!.name.toUpperCase()
        : `STACK · ${value.length}`;

  return (
    <Combobox
      items={skills}
      multiple
      value={value}
      onValueChange={(next) => onChange(next.map((skill) => skill.id))}
      itemToStringLabel={(skill) => skill.name}
      isItemEqualToValue={(a, b) => a.id === b.id}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={FILTER_TOGGLE}
            aria-pressed={value.length > 0}
            aria-label={`Filter by stack${value.length > 0 ? ` (${value.length} selected)` : ""}`}
          />
        }
      >
        {label}
      </ComboboxTrigger>
      <ComboboxContent align="start" className="w-56 min-w-56">
        <ComboboxInput placeholder="Filter stack…" showTrigger={false} />
        <ComboboxList className="p-1">
          {(skill: (typeof skills)[number]) => (
            <ComboboxItem key={skill.id} value={skill} className="tracking-widest uppercase">
              {skill.name}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty className="tracking-widest uppercase">No match</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
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

function DirectorySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-42 w-full" />
      ))}
    </div>
  );
}
