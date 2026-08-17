import {
  ArrowDown01Icon,
  GridViewIcon,
  LeftToRightListBulletIcon,
  SortByDown02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useEffect, useState } from "react";

import { BOTTOM_NAV_HEIGHT } from "@/components/layout/MobileShell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FacetPicker } from "@/components/ui/facet-picker";
import { SearchField } from "@/components/ui/search-field";
import {
  type CollabCompensationType,
  type CollabPostType,
  type CollabStatus,
  collabStore,
  setCollabLayout,
} from "@/lib/collab-store";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import {
  type CollabBoardSearch,
  type CollabBoardSort,
  DEFAULT_SORT,
  SORT_OPTIONS,
  sortPreset,
  useCollabBoardSearch,
} from "./collab-filters";
import { useCollabRoleCounts, useCollabSkillCounts } from "./use-collab-counts";

export const COLLAB_SEARCH_INPUT_ID = "collab-search";

/** Menus put the "no constraint" choice first; picking it clears the filter. */
type Option = { value: string; label: string };

const TYPE_OPTIONS: Option[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid work" },
  { value: "hobby", label: "Hobby" },
];

const STATUS_OPTIONS: Option[] = [
  { value: "any", label: "Any status" },
  { value: "recruiting", label: "Open" },
  { value: "party_full", label: "Closed" },
];

const EXPERIENCE_OPTIONS: Option[] = [
  { value: "any", label: "Any level" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "experienced", label: "Experienced" },
];

const COMP_OPTIONS: Option[] = [
  { value: "all", label: "Any pay" },
  { value: "hourly", label: "Hourly" },
  { value: "fixed", label: "Fixed" },
  { value: "rev_share", label: "Rev share" },
  { value: "negotiable", label: "Negotiable" },
];

/** Solo devs and teams — the board's two kinds of poster. */
const POSTER_OPTIONS: Option[] = [
  { value: "all", label: "Anyone" },
  { value: "solo", label: "Solo devs" },
  { value: "team", label: "Teams" },
];

/** The `solo` search value behind each poster menu choice. */
export function posterToSolo(value: string): boolean | undefined {
  return value === "all" ? undefined : value === "solo";
}

export function soloToPoster(solo: boolean | undefined): string {
  return solo === undefined ? "all" : solo ? "solo" : "team";
}

interface CollabToolbarProps {
  /** Narrow layouts render search + a sheet trigger instead of the menu row. */
  onOpenFilters?: () => void;
  /** Touch layouts hand the whole control row to {@link CollabFloatingControls},
   *  leaving the toolbar as search alone. */
  controlsElsewhere?: boolean;
}

/**
 * The board's whole control surface, two lines: search on top,
 * everything that shapes the listing below. The primary navigation (post
 * type) is a dropdown like the other facets — as tabs it ate a full row
 * by itself — and display controls (sort, layout) are plain icon buttons
 * on the trailing edge, matching the jam board. Creating a post is the
 * hero's job, not the toolbar's.
 */
export function CollabToolbar({ onOpenFilters, controlsElsewhere }: CollabToolbarProps) {
  const { search, setSearch } = useCollabBoardSearch();

  if (controlsElsewhere) return <CollabSearchInput className="h-10 w-full" />;

  return (
    <div className="flex flex-col gap-2">
      {/* Line 1 — search owns the width. */}
      <CollabSearchInput className="h-10 w-full" />

      {/* Line 2 — facets on the left, display controls on the right. */}
      <div className="flex flex-wrap items-center gap-2">
        {onOpenFilters ? (
          <Button variant="outline" size="sm" onClick={onOpenFilters} className="tracking-widest">
            FILTERS
          </Button>
        ) : (
          <>
            <FilterMenu
              label="TYPE"
              options={TYPE_OPTIONS}
              value={search.type ?? "all"}
              onChange={(v) => setSearch({ type: v === "all" ? undefined : (v as CollabPostType) })}
            />
            <RoleFilterMenu selected={search.roles ?? []} />
            <FilterMenu
              label="STATUS"
              options={STATUS_OPTIONS}
              value={search.status ?? "any"}
              onChange={(v) => setSearch({ status: v === "any" ? undefined : (v as CollabStatus) })}
            />
            <FilterMenu
              label="LEVEL"
              options={EXPERIENCE_OPTIONS}
              value={search.level ?? "any"}
              onChange={(v) =>
                setSearch({
                  level: v === "any" ? undefined : (v as CollabBoardSearch["level"]),
                })
              }
            />
            {search.type === "paid" ? (
              <FilterMenu
                label="PAY"
                options={COMP_OPTIONS}
                value={search.comp ?? "all"}
                onChange={(v) =>
                  setSearch({
                    comp: v === "all" ? undefined : (v as CollabCompensationType),
                  })
                }
              />
            ) : null}
            <StackFilterMenu selected={search.skills ?? []} />
            <FilterMenu
              label="POSTED BY"
              options={POSTER_OPTIONS}
              value={soloToPoster(search.solo)}
              onChange={(v) => setSearch({ solo: posterToSolo(v) })}
            />
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <CollabDisplayControls />
        </div>
      </div>
    </div>
  );
}

/**
 * Sort and card/list toggle as bare icon buttons, jam-board style. Native
 * `title` hints rather than SimpleTooltip, which renders its own button
 * trigger and would nest a button in a button.
 */
function CollabDisplayControls({ large }: { large?: boolean }) {
  const { search, setSearch } = useCollabBoardSearch();
  const layout = useStore(collabStore, (s) => s.layout);

  const sortLabel = sortPreset(search.sort).label;
  const nextLayout = layout === "cards" ? "list" : "cards";
  const size = large ? "icon-lg" : "icon-sm";
  const iconSize = large ? 18 : 14;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size={size}
              title={`Sort: ${sortLabel}`}
              aria-label={`Sort order: ${sortLabel}`}
            />
          }
        >
          <HugeiconsIcon icon={SortByDown02Icon} size={iconSize} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44 p-1">
          <DropdownMenuRadioGroup
            value={search.sort ?? DEFAULT_SORT}
            onValueChange={(v) =>
              setSearch({ sort: v === DEFAULT_SORT ? undefined : (v as CollabBoardSort) })
            }
          >
            {SORT_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="outline"
        size={size}
        onClick={() => setCollabLayout(nextLayout)}
        title={`Switch to ${nextLayout === "list" ? "list" : "card"} view`}
        aria-label={`Switch to ${nextLayout === "list" ? "list" : "card"} view`}
      >
        <HugeiconsIcon
          icon={nextLayout === "list" ? LeftToRightListBulletIcon : GridViewIcon}
          size={iconSize}
        />
      </Button>
    </>
  );
}

/**
 * The touch layout's control row: FILTERS on the leading edge, sort and view
 * on the trailing one, floating just above the bottom nav island.
 *
 * Down here rather than in the toolbar because on a phone the toolbar is
 * three quarters of the way from the thumb, and these three are what you
 * reach for repeatedly while scanning the board. Split to the two edges so
 * neither thumb has to cross the screen, with the middle left open so the
 * list stays readable behind them.
 */
export function CollabFloatingControls({ onOpenFilters }: { onOpenFilters: () => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex items-center justify-between px-4"
      style={{
        bottom: `calc(${BOTTOM_NAV_HEIGHT} - 0.5rem)`,
        paddingLeft: "calc(1rem + env(safe-area-inset-left))",
        paddingRight: "calc(1rem + env(safe-area-inset-right))",
      }}
    >
      <Button
        variant="outline"
        size="lg"
        onClick={onOpenFilters}
        className="pointer-events-auto tracking-widest"
      >
        FILTERS
      </Button>
      <div className="pointer-events-auto flex items-center gap-2">
        <CollabDisplayControls large />
      </div>
    </div>
  );
}

/**
 * Debounced search box. The keystrokes live here rather than in the URL
 * so typing doesn't refire the listing query (or rewrite history) on
 * every character.
 */
export function CollabSearchInput({ className }: { className?: string }) {
  const { search, setSearch } = useCollabBoardSearch();
  const urlSearch = search.q ?? "";
  const [value, setValue] = useState(urlSearch);

  // Only write when the box has actually diverged from the URL. Without
  // the guard the box commits its own initial value 300ms after mount,
  // which is a router navigation — and the router runs every navigation
  // through `document.startViewTransition`, same-URL ones included. That
  // lands a second cross-route fade on top of the board's entrance.
  useEffect(() => {
    if (value === urlSearch) return;
    const timer = setTimeout(() => setSearch({ q: value || undefined }), 300);
    return () => clearTimeout(timer);
  }, [value, urlSearch, setSearch]);

  // Pull external resets (CLEAR ALL, chip ×) back into the local input.
  useEffect(() => {
    setValue((current) => (current === urlSearch ? current : urlSearch));
  }, [urlSearch]);

  return (
    <SearchField
      id={COLLAB_SEARCH_INPUT_ID}
      value={value}
      onChange={setValue}
      placeholder="Search roles and projects…"
      autoComplete="off"
      size="default"
      containerClassName={className}
      className="text-[11px] tracking-widest"
    />
  );
}

/**
 * The seats posts are hiring for — the board's headline vocabulary, in
 * the same picker idiom as the stack so "find me a composer" is one
 * click, not a free-text search.
 *
 * Renders nothing while the roles table is empty, like the stack menu —
 * an always-empty menu button just advertises a dead end.
 */
export function RoleFilterMenu({ selected, inline }: { selected: number[]; inline?: boolean }) {
  const { setSearch } = useCollabBoardSearch();
  const { data } = useQuery({
    ...orpc.listCollabRoles.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: counts } = useCollabRoleCounts();
  const roles = data ?? [];
  if (roles.length === 0) return null;

  return (
    <FacetPicker
      label="ROLE"
      options={roles}
      selectedIds={selected}
      onChange={(roles) => setSearch({ roles: roles.length > 0 ? roles : undefined })}
      counts={counts}
      searchPlaceholder="Search roles…"
      hint="Shows posts hiring any of these."
      inline={inline}
    />
  );
}

/**
 * Tech stack, on both lanes — "which projects run on Godot" and "who
 * knows Godot" are the same question asked of the same vocabulary, so
 * they get the same control. See {@link FacetPicker} for why it isn't the
 * plain checkbox menu the single-choice facets use.
 *
 * Renders nothing while the skills table is empty, which is the honest
 * state until the vocabulary is seeded — an always-empty menu button
 * just advertises a dead end.
 */
export function StackFilterMenu({ selected, inline }: { selected: number[]; inline?: boolean }) {
  const { search, setSearch } = useCollabBoardSearch();
  const { data } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: counts } = useCollabSkillCounts();
  const skills = data ?? [];
  if (skills.length === 0) return null;

  const matchAll = Boolean(search.matchAll) && selected.length > 1;

  return (
    <FacetPicker
      label="STACK"
      options={skills}
      selectedIds={selected}
      onChange={(skills) => setSearch({ skills: skills.length > 0 ? skills : undefined })}
      counts={counts}
      searchPlaceholder="Search engines, languages, tools…"
      hint={matchAll ? "Shows posts using all of these." : "Shows posts using any of these."}
      inline={inline}
    />
  );
}

interface FilterMenuProps {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}

function FilterMenu({ label, options, value, onChange }: FilterMenuProps) {
  const isConstrained = value !== options[0]?.value;
  const selected = options.find((o) => o.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "tracking-widest uppercase",
              isConstrained && "border-primary text-primary",
            )}
          />
        }
      >
        {isConstrained && selected ? selected.label : label}
        <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-44 p-1">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
