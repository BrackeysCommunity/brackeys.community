import { useEffect, useRef, useState } from "react";

import { Toolbar, ToolbarFloatingControls } from "@/components/common/Toolbar";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
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
import { FILTER_TOGGLE, FilterToggle, SortMenu } from "@/components/ui/filter-menu";
import { SearchField } from "@/components/ui/search-field";

import {
  AVAILABILITY_OPTIONS,
  DEFAULT_SORT,
  effectiveSortDir,
  type MemberAvailability,
  type MembersSearch,
  type MembersSort,
  RATE_OPTIONS,
  type SetMembersSearch,
  SORT_OPTIONS,
  type SortDirection,
  sortDirPatch,
  sortPatch,
  TZ_OPTIONS,
} from "./members-filters";
import { MembersRolePicker } from "./MembersRolePicker";
import { MembersSkillPicker } from "./MembersSkillPicker";

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
  const searchInput = (
    <MembersSearchInput
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
      controls={<MembersSortMenu search={search} setSearch={setSearch} />}
    >
      <FilterToggle
        label="OPEN TO WORK"
        pressed={!!search.open}
        onPressedChange={(on) => setSearch({ open: on ? true : undefined })}
      />
      <MembersRolePicker search={search} setSearch={setSearch} />
      <AvailabilityMenu
        selected={search.availability ?? []}
        onChange={(next) => setSearch({ availability: next.length > 0 ? next : undefined })}
      />
      <MembersSkillPicker search={search} setSearch={setSearch} />
      <RateMenu rate={search.rate} setSearch={setSearch} />
      <TimezoneMenu tz={search.tz} setSearch={setSearch} />
    </Toolbar>
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
    <ToolbarFloatingControls onOpenFilters={onOpenFilters}>
      <MembersSortMenu size="lg" search={search} setSearch={setSearch} />
    </ToolbarFloatingControls>
  );
}

/** Sort key and direction, chosen separately; the direction reads in the key's own terms. */
function MembersSortMenu({
  search,
  setSearch,
  size,
}: {
  search: MembersSearch;
  setSearch: SetMembersSearch;
  size?: "sm" | "lg";
}) {
  const sort = search.sort ?? DEFAULT_SORT;
  const option = SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0]!;
  return (
    <SortMenu
      size={size}
      options={SORT_OPTIONS}
      value={sort}
      onChange={(v) => setSearch(sortPatch(v as MembersSort))}
      direction={{
        options: [
          { value: "desc", label: option.dirLabels.desc },
          { value: "asc", label: option.dirLabels.asc },
        ],
        value: effectiveSortDir(search),
        onChange: (v) => setSearch(sortDirPatch(sort, v as SortDirection)),
      }}
    />
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
            Any rate
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
 * Timezone as a window around the viewer — a ceiling like the rate menu,
 * so a radio group: "within ±6h" already contains "within ±3h". The URL
 * stores only the window; the viewer's own offset is derived from the
 * browser at query time.
 */
function TimezoneMenu({ tz, setSearch }: { tz?: number; setSearch: SetMembersSearch }) {
  const label = TZ_OPTIONS.find((o) => o.value === tz)?.label ?? "TIMEZONE";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={FILTER_TOGGLE}
            aria-pressed={tz != null}
            aria-label={`Filter by timezone${tz != null ? ` (within ±${tz} hours)` : ""}`}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-48 p-1">
        <DropdownMenuRadioGroup
          value={tz != null ? String(tz) : "any"}
          onValueChange={(value) => setSearch({ tz: value === "any" ? undefined : Number(value) })}
        >
          <DropdownMenuRadioItem value="any" closeOnClick>
            Any timezone
          </DropdownMenuRadioItem>
          {TZ_OPTIONS.map((option) => (
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
