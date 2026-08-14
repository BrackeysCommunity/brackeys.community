import {
  ArrowDown01Icon,
  GridViewIcon,
  LeftToRightListBulletIcon,
  SortByDown02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";

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
  type CollabExperienceLevel,
  type CollabPostType,
  type CollabSortBy,
  type CollabSortOrder,
  type CollabStatus,
  collabStore,
  setCollabFilters,
  setCollabLayout,
} from "@/lib/collab-store";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { useCollabSkillCounts } from "./use-collab-counts";

export const COLLAB_SEARCH_INPUT_ID = "collab-search";

/** Menus put the "no constraint" choice first; picking it clears the filter. */
type Option = { value: string; label: string };

const TYPE_OPTIONS: Option[] = [
  { value: "all", label: "ALL" },
  { value: "paid", label: "PAID WORK" },
  { value: "hobby", label: "HOBBY" },
];

const STATUS_OPTIONS: Option[] = [
  { value: "any", label: "ANY STATUS" },
  { value: "recruiting", label: "OPEN" },
  { value: "party_full", label: "CLOSED" },
];

const EXPERIENCE_OPTIONS: Option[] = [
  { value: "any", label: "ANY LEVEL" },
  { value: "beginner", label: "BEGINNER" },
  { value: "intermediate", label: "INTERMEDIATE" },
  { value: "experienced", label: "EXPERIENCED" },
];

const COMP_OPTIONS: Option[] = [
  { value: "all", label: "ANY PAY" },
  { value: "hourly", label: "HOURLY" },
  { value: "fixed", label: "FIXED" },
  { value: "rev_share", label: "REV SHARE" },
  { value: "negotiable", label: "NEGOTIABLE" },
];

/** Sort presets pair a column with a direction — one choice, no
 *  separate order toggle to keep in sync. */
const SORT_OPTIONS: { value: string; label: string; by: CollabSortBy; order: CollabSortOrder }[] = [
  { value: "createdAt:desc", label: "NEWEST", by: "createdAt", order: "desc" },
  { value: "createdAt:asc", label: "OLDEST", by: "createdAt", order: "asc" },
  { value: "updatedAt:desc", label: "RECENTLY ACTIVE", by: "updatedAt", order: "desc" },
];

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
  const filters = useStore(collabStore, (s) => s.filters);

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
              value={filters.type ?? "all"}
              onChange={(v) =>
                setCollabFilters({ type: v === "all" ? undefined : (v as CollabPostType) })
              }
            />
            <FilterMenu
              label="STATUS"
              options={STATUS_OPTIONS}
              value={filters.status ?? "any"}
              onChange={(v) =>
                setCollabFilters({ status: v === "any" ? undefined : (v as CollabStatus) })
              }
            />
            <FilterMenu
              label="LEVEL"
              options={EXPERIENCE_OPTIONS}
              value={filters.experienceLevel ?? "any"}
              onChange={(v) =>
                setCollabFilters({
                  experienceLevel: v === "any" ? undefined : (v as CollabExperienceLevel),
                })
              }
            />
            {filters.type === "paid" ? (
              <FilterMenu
                label="PAY"
                options={COMP_OPTIONS}
                value={filters.compensationType ?? "all"}
                onChange={(v) =>
                  setCollabFilters({
                    compensationType: v === "all" ? undefined : (v as CollabCompensationType),
                  })
                }
              />
            ) : null}
            <StackFilterMenu selected={filters.skillIds} />
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
  const filters = useStore(collabStore, (s) => s.filters);
  const layout = useStore(collabStore, (s) => s.layout);

  const sortValue = `${filters.sortBy}:${filters.sortOrder}`;
  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortValue)?.label ?? "NEWEST";
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
            value={sortValue}
            onValueChange={(v) => {
              const preset = SORT_OPTIONS.find((o) => o.value === v);
              if (preset) setCollabFilters({ sortBy: preset.by, sortOrder: preset.order });
            }}
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
 * Debounced search box. Owned here rather than in the store so
 * keystrokes don't refire the listing query on every character.
 */
export function CollabSearchInput({ className }: { className?: string }) {
  const storeSearch = useStore(collabStore, (s) => s.filters.search);
  const [value, setValue] = useState(storeSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setCollabFilters({ search: value }), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  // Pull external resets (CLEAR ALL, chip ×) back into the local input.
  useEffect(() => {
    setValue((current) => (current === storeSearch ? current : storeSearch));
  }, [storeSearch]);

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
  const { data } = useQuery({
    ...orpc.listSkills.queryOptions({ input: {} }),
    staleTime: 5 * 60 * 1000,
  });
  const { data: counts } = useCollabSkillCounts();
  const skills = data ?? [];
  if (skills.length === 0) return null;

  return (
    <FacetPicker
      label="STACK"
      options={skills}
      selectedIds={selected}
      onChange={(skillIds) => setCollabFilters({ skillIds })}
      counts={counts}
      searchPlaceholder="Search engines, languages, tools…"
      hint="Shows posts using any of these."
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
            className={cn("tracking-widest", isConstrained && "border-primary text-primary")}
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
