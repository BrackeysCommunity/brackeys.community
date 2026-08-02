import {
  Add01Icon,
  ArrowDown01Icon,
  CubeIcon,
  GridViewIcon,
  LeftToRightListBulletIcon,
  Login01Icon,
  SortByDown02Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
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

import { useCollabTypeCounts } from "./use-collab-counts";

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
  authenticated: boolean;
  onCreate: () => void;
}

/**
 * The board's whole control surface, two lines: search + the create CTA
 * on top, everything that shapes the listing below. The primary
 * navigation (post type) is a dropdown like the other facets — as tabs
 * it ate a full row by itself — and display controls (sort, layout) are
 * plain icon buttons on the trailing edge, matching the jam board.
 */
export function CollabToolbar({ onOpenFilters, authenticated, onCreate }: CollabToolbarProps) {
  const filters = useStore(collabStore, (s) => s.filters);
  const layout = useStore(collabStore, (s) => s.layout);
  const { data: counts } = useCollabTypeCounts();
  const isPeople = filters.listingType === "people";

  const sortValue = `${filters.sortBy}:${filters.sortOrder}`;
  const sortLabel = SORT_OPTIONS.find((o) => o.value === sortValue)?.label ?? "NEWEST";
  const nextLayout = layout === "cards" ? "list" : "cards";

  return (
    <div className="flex flex-col gap-2">
      {/* Line 1 — search owns the width, the CTA rides its trailing edge. */}
      <div className="flex items-center gap-2">
        <CollabSearchInput className="h-10 min-w-0 flex-1" />
        <Button
          onClick={onCreate}
          variant="default"
          size="lg"
          className="h-10 shrink-0 tracking-widest"
        >
          <HugeiconsIcon icon={authenticated ? Add01Icon : Login01Icon} size={14} />
          <span className="hidden sm:inline">
            {authenticated ? "POST A ROLE" : "SIGN IN TO POST"}
          </span>
          <span className="sm:hidden">{authenticated ? "POST" : "SIGN IN"}</span>
        </Button>
      </div>

      {/* Line 2 — facets on the left, listing mode + display on the right. */}
      <div className="flex flex-wrap items-center gap-2">
        {onOpenFilters ? (
          <Button variant="outline" size="sm" onClick={onOpenFilters} className="tracking-widest">
            FILTERS
          </Button>
        ) : !isPeople ? (
          <>
            <FilterMenu
              label="TYPE"
              options={TYPE_OPTIONS.map((o) => ({
                ...o,
                count: counts?.[o.value as "all" | CollabPostType],
              }))}
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
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl
            value={isPeople ? "people" : "posts"}
            onChange={(v) => setCollabFilters({ listingType: v as "posts" | "people" })}
            size="sm"
            aria-label="Listing type"
          >
            <SegmentedControl.Item
              value="posts"
              icon={<HugeiconsIcon icon={CubeIcon} />}
              className="tracking-widest"
            >
              PROJECTS
            </SegmentedControl.Item>
            <SegmentedControl.Item
              value="people"
              icon={<HugeiconsIcon icon={UserGroupIcon} />}
              className="tracking-widest"
            >
              PEOPLE
            </SegmentedControl.Item>
          </SegmentedControl>

          {/* Display controls as bare icon buttons, jam-board style.
              Native `title` hints — SimpleTooltip renders its own button
              trigger, which would nest a button in a button. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  title={`Sort: ${sortLabel}`}
                  aria-label={`Sort order: ${sortLabel}`}
                />
              }
            >
              <HugeiconsIcon icon={SortByDown02Icon} size={14} />
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

          {!isPeople ? (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setCollabLayout(nextLayout)}
              title={`Switch to ${nextLayout === "list" ? "list" : "card"} view`}
              aria-label={`Switch to ${nextLayout === "list" ? "list" : "card"} view`}
            >
              <HugeiconsIcon
                icon={nextLayout === "list" ? LeftToRightListBulletIcon : GridViewIcon}
                size={14}
              />
            </Button>
          ) : null}
        </div>
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
      placeholder="Search posts, projects, devs…"
      autoComplete="off"
      size="default"
      containerClassName={cn("dark:bg-emboss-surface!", className)}
      className="text-[11px] tracking-widest"
    />
  );
}

interface FilterMenuProps {
  label: string;
  options: (Option & { count?: number })[];
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
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              disabled={option.count === 0 && option.value !== value && option.value !== "all"}
              className="justify-between gap-4 tracking-widest"
            >
              {option.label}
              {option.count !== undefined ? (
                <span className="text-muted-foreground tabular-nums">{option.count}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
