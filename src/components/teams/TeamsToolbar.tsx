import { useEffect, useRef, useState } from "react";

import { Toolbar, ToolbarFloatingControls } from "@/components/common/Toolbar";
import { FilterToggle, SortMenu } from "@/components/ui/filter-menu";
import { SearchField } from "@/components/ui/search-field";

import {
  DEFAULT_SORT,
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
    <Toolbar
      search={searchInput}
      onOpenFilters={onOpenFilters}
      controls={
        <SortMenu
          options={SORT_OPTIONS}
          value={search.sort ?? DEFAULT_SORT}
          onChange={(v) => setSearch({ sort: v === DEFAULT_SORT ? undefined : (v as TeamsSort) })}
        />
      }
    >
      <FilterToggle
        label="RECRUITING"
        pressed={!!search.recruiting}
        onPressedChange={(on) => setSearch({ recruiting: on ? true : undefined })}
      />
      <FilterToggle
        label="HAS SHIPPED"
        pressed={!!search.shipped}
        onPressedChange={(on) => setSearch({ shipped: on ? true : undefined })}
      />
      <TeamsSkillPicker search={search} setSearch={setSearch} />
    </Toolbar>
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
    <ToolbarFloatingControls onOpenFilters={onOpenFilters}>
      <SortMenu
        size="lg"
        options={SORT_OPTIONS}
        value={search.sort ?? DEFAULT_SORT}
        onChange={(v) => setSearch({ sort: v === DEFAULT_SORT ? undefined : (v as TeamsSort) })}
      />
    </ToolbarFloatingControls>
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
