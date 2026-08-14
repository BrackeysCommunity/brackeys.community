import { SortByDown02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
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
import { SearchField } from "@/components/ui/search-field";

import {
  DEFAULT_SORT,
  FILTER_TOGGLE,
  type SetTeamsSearch,
  SORT_OPTIONS,
  type TeamsSearch,
  type TeamsSort,
} from "./teams-filters";
import { TeamsSkillPicker } from "./TeamsSkillPicker";

export const TEAMS_SEARCH_INPUT_ID = "teams-search";

interface TeamsToolbarProps {
  search: TeamsSearch;
  setSearch: SetTeamsSearch;
  /** Narrow layouts render search + a sheet trigger instead of the toggle row. */
  onOpenFilters?: () => void;
  /** Touch layouts hand the whole control row to {@link TeamsFloatingControls},
   *  leaving the toolbar as search alone. */
  controlsElsewhere?: boolean;
}

/**
 * The directory's control surface, two lines: search on top, everything
 * that shapes the listing below — the same frame as the collab board's
 * toolbar, so the two boards are worked the same way. The match count is
 * not here: it's a readout of the result, and lives with the chips in
 * {@link TeamsActiveFilters} where it can scroll away.
 */
export function TeamsToolbar({
  search,
  setSearch,
  onOpenFilters,
  controlsElsewhere,
}: TeamsToolbarProps) {
  const searchInput = (
    <TeamsSearchInput
      value={search.q ?? ""}
      onChange={(q) => setSearch({ q: q || undefined })}
      className="h-10 w-full"
    />
  );

  if (controlsElsewhere) return searchInput;

  return (
    <div className="flex flex-col gap-2">
      {/* Line 1 — search owns the width. */}
      {searchInput}

      {/* Line 2 — facets on the left, display controls on the right. */}
      <div className="flex flex-wrap items-center gap-2">
        {onOpenFilters ? (
          <Button variant="outline" size="sm" onClick={onOpenFilters} className="tracking-widest">
            FILTERS
          </Button>
        ) : (
          <>
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
            <TeamsSkillPicker search={search} setSearch={setSearch} />
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <TeamsSortMenu sort={search.sort ?? DEFAULT_SORT} setSearch={setSearch} />
        </div>
      </div>
    </div>
  );
}

/**
 * The touch layout's control row: FILTERS on the leading edge, sort on the
 * trailing one, floating just above the bottom nav island.
 *
 * Down here rather than in the toolbar because on a phone the toolbar is
 * three quarters of the way from the thumb, and these are what you reach for
 * repeatedly while scanning the directory. Split to the two edges so neither
 * thumb has to cross the screen, with the middle left open so the grid stays
 * readable behind them.
 */
export function TeamsFloatingControls({
  search,
  setSearch,
  onOpenFilters,
}: {
  search: TeamsSearch;
  setSearch: SetTeamsSearch;
  onOpenFilters: () => void;
}) {
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
        <TeamsSortMenu sort={search.sort ?? DEFAULT_SORT} setSearch={setSearch} large />
      </div>
    </div>
  );
}

/**
 * Sort as a bare icon button, jam-board style. A native `title` hint rather
 * than SimpleTooltip, which renders its own button trigger and would nest a
 * button in a button.
 */
function TeamsSortMenu({
  sort,
  setSearch,
  large,
}: {
  sort: TeamsSort;
  setSearch: SetTeamsSearch;
  large?: boolean;
}) {
  const label = SORT_OPTIONS.find((o) => o.value === sort)!.label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size={large ? "icon-lg" : "icon-sm"}
            title={`Sort: ${label}`}
            aria-label={`Sort order: ${label}`}
          />
        }
      >
        <HugeiconsIcon icon={SortByDown02Icon} size={large ? 18 : 14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48 p-1">
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) =>
            setSearch({ sort: value === DEFAULT_SORT ? undefined : (value as TeamsSort) })
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
  );
}

/**
 * Debounced search box. The typed value is owned here rather than in the
 * URL so a keystroke doesn't rewrite history and refire the listing query
 * on every character.
 */
function TeamsSearchInput({
  value: committed,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [value, setValue] = useState(committed);

  // Held in a ref so the debounce is keyed on the typed value alone —
  // the writer is rebuilt every render and would otherwise restart the
  // timer on any unrelated re-render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (value === committed) return;
    const timer = setTimeout(() => onChangeRef.current(value), 300);
    return () => clearTimeout(timer);
  }, [value, committed]);

  // Pull external resets (CLEAR ALL, chip ×, a shared link) back into the
  // local input.
  useEffect(() => {
    setValue((current) => (current === committed ? current : committed));
  }, [committed]);

  return (
    <SearchField
      id={TEAMS_SEARCH_INPUT_ID}
      value={value}
      onChange={setValue}
      placeholder="Search teams by name or what they make…"
      autoComplete="off"
      size="default"
      containerClassName={className}
      className="text-[11px] tracking-widest"
    />
  );
}
