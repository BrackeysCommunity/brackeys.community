import { SortByDown02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { BOTTOM_NAV_HEIGHT } from "@/components/layout/MobileShell";
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
import { orpc } from "@/orpc/client";

import {
  AVAILABILITY_OPTIONS,
  DEFAULT_SORT,
  FILTER_TOGGLE,
  type MemberAvailability,
  type MembersSearch,
  type MembersSort,
  RATE_OPTIONS,
  type SetMembersSearch,
  SORT_OPTIONS,
} from "./members-filters";

export const MEMBERS_SEARCH_INPUT_ID = "members-search";

interface MembersToolbarProps {
  search: MembersSearch;
  setSearch: SetMembersSearch;
  /** Narrow layouts render search + a sheet trigger instead of the toggle row. */
  onOpenFilters?: () => void;
  /** Touch layouts hand the whole control row to {@link MembersFloatingControls},
   *  leaving the toolbar as search alone. */
  controlsElsewhere?: boolean;
}

/**
 * The directory's control surface, two lines: search on top, everything
 * that shapes the listing below — the same frame as the team directory's
 * toolbar, so the two boards are worked the same way. The match count is
 * not here: it's a readout of the result, and lives with the chips in
 * {@link MembersActiveFilters} where it can scroll away.
 */
export function MembersToolbar({
  search,
  setSearch,
  onOpenFilters,
  controlsElsewhere,
}: MembersToolbarProps) {
  const skillIds = search.skills ?? [];

  const searchInput = (
    <MembersSearchInput
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
              onClick={() => setSearch({ open: search.open ? undefined : true })}
              className={FILTER_TOGGLE}
              aria-pressed={!!search.open}
            >
              OPEN TO WORK
            </Button>
            <AvailabilityMenu
              selected={search.availability ?? []}
              onChange={(next) => setSearch({ availability: next.length > 0 ? next : undefined })}
            />
            <SkillFilterCombobox
              selected={skillIds}
              onChange={(next) => setSearch({ skills: next.length > 0 ? next : undefined })}
            />
            <RateMenu rate={search.rate} setSearch={setSearch} />
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <MembersSortMenu sort={search.sort ?? DEFAULT_SORT} setSearch={setSearch} />
        </div>
      </div>
    </div>
  );
}

/**
 * The touch layout's control row: FILTERS on the leading edge, sort on the
 * trailing one, floating just above the bottom nav island. Same reasoning
 * as the team directory's — on a phone the toolbar is three quarters of
 * the way from the thumb, and these are what you reach for repeatedly.
 */
export function MembersFloatingControls({
  search,
  setSearch,
  onOpenFilters,
}: {
  search: MembersSearch;
  setSearch: SetMembersSearch;
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
        <MembersSortMenu sort={search.sort ?? DEFAULT_SORT} setSearch={setSearch} large />
      </div>
    </div>
  );
}

/**
 * Sort as a bare icon button, jam-board style. A native `title` hint rather
 * than SimpleTooltip, which renders its own button trigger and would nest a
 * button in a button.
 */
function MembersSortMenu({
  sort,
  setSearch,
  large,
}: {
  sort: MembersSort;
  setSearch: SetMembersSearch;
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
            setSearch({ sort: value === DEFAULT_SORT ? undefined : (value as MembersSort) })
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
 * Commitment level. Three values that read as "any of these" rather than
 * one choice, so a multi-select menu rather than the sort's radio group —
 * "full-time or part-time" is a question people actually have.
 */
function AvailabilityMenu({
  selected,
  onChange,
}: {
  selected: MemberAvailability[];
  onChange: (next: MemberAvailability[]) => void;
}) {
  const value = AVAILABILITY_OPTIONS.filter((o) => selected.includes(o.value));
  const label =
    value.length === 0
      ? "AVAILABILITY"
      : value.length === 1
        ? value[0]!.label
        : `AVAILABILITY · ${value.length}`;

  return (
    <Combobox
      items={AVAILABILITY_OPTIONS}
      multiple
      value={value}
      onValueChange={(next: typeof AVAILABILITY_OPTIONS) => onChange(next.map((o) => o.value))}
      itemToStringLabel={(option: (typeof AVAILABILITY_OPTIONS)[number]) => option.label}
      isItemEqualToValue={(
        a: (typeof AVAILABILITY_OPTIONS)[number],
        b: (typeof AVAILABILITY_OPTIONS)[number],
      ) => a.value === b.value}
    >
      <ComboboxTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={FILTER_TOGGLE}
            aria-pressed={value.length > 0}
            aria-label={`Filter by availability${value.length > 0 ? ` (${value.length} selected)` : ""}`}
          />
        }
      >
        {label}
      </ComboboxTrigger>
      <ComboboxContent align="start" className="w-48 min-w-48">
        <ComboboxList>
          {(option: (typeof AVAILABILITY_OPTIONS)[number]) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * Rate as a ceiling. A radio group rather than the multi-selects beside
 * it — "under $50" already contains "under $25", so picking two would
 * mean nothing. ANY is the off position, kept in the list so the filter
 * can be cleared without leaving the menu.
 */
function RateMenu({ rate, setSearch }: { rate?: number; setSearch: SetMembersSearch }) {
  const label = RATE_OPTIONS.find((o) => o.value === rate)?.label ?? "RATE";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={FILTER_TOGGLE}
            aria-pressed={rate != null}
            aria-label={`Filter by hourly rate${rate != null ? ` (under $${rate})` : ""}`}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-44 p-1">
        <DropdownMenuRadioGroup
          value={rate != null ? String(rate) : "any"}
          onValueChange={(value) =>
            setSearch({ rate: value === "any" ? undefined : Number(value) })
          }
        >
          <DropdownMenuRadioItem value="any" closeOnClick>
            ANY RATE
          </DropdownMenuRadioItem>
          {RATE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={String(option.value)} closeOnClick>
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
function MembersSearchInput({
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
      id={MEMBERS_SEARCH_INPUT_ID}
      value={value}
      onChange={setValue}
      placeholder="Search members by name or what they're after…"
      autoComplete="off"
      size="default"
      containerClassName={className}
      className="text-[11px] tracking-widest"
    />
  );
}

/**
 * Skill filter. The roster's vocabulary runs to dozens of entries, which
 * is past the point where a checkbox menu is usable — so this is a combo
 * box: type to narrow, tick to select, ticks accumulate. The trigger
 * carries the same pressed treatment as the boolean filters beside it.
 */
function SkillFilterCombobox({
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
      ? "SKILLS"
      : value.length === 1
        ? value[0]!.name.toUpperCase()
        : `SKILLS · ${value.length}`;

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
            aria-label={`Filter by skill${value.length > 0 ? ` (${value.length} selected)` : ""}`}
          />
        }
      >
        {label}
      </ComboboxTrigger>
      <ComboboxContent align="start" className="w-56 min-w-56">
        <ComboboxInput placeholder="Filter skills…" showTrigger={false} />
        <ComboboxList>
          {(skill: (typeof skills)[number]) => (
            <ComboboxItem key={skill.id} value={skill}>
              {skill.name}
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>No match</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
