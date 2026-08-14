import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import {
  AVAILABILITY_OPTIONS,
  CLEARED_MEMBER_FILTERS,
  countActiveMemberFilters,
  DEFAULT_SORT,
  type MemberAvailability,
  type MembersSearch,
  type MembersSort,
  RATE_OPTIONS,
  type SetMembersSearch,
  SORT_OPTIONS,
  TZ_OPTIONS,
} from "./members-filters";
import { MembersRolePicker } from "./MembersRolePicker";
import { MembersSkillPicker } from "./MembersSkillPicker";

interface MembersFilterPanelProps {
  search: MembersSearch;
  setSearch: SetMembersSearch;
  /** Live match count for the confirm button; `null` while loading. */
  resultCount: number | null;
  /** Closes the mobile sheet — also drives the result-count CTA. */
  onDone?: () => void;
}

/**
 * Full filter set for the mobile sheet. On wide screens these same
 * controls live in `MembersToolbar`; here they get room to breathe as
 * chip rows, and the confirm button carries the live result count so you
 * know what you're about to see before dismissing the sheet. The team
 * directory's drawer is the same panel for its own filters — one
 * filtering idiom across every board.
 */
export function MembersFilterPanel({
  search,
  setSearch,
  resultCount,
  onDone,
}: MembersFilterPanelProps) {
  const availability = search.availability ?? [];

  const toggleAvailability = (value: MemberAvailability) => {
    const next = availability.includes(value)
      ? availability.filter((v) => v !== value)
      : [...availability, value];
    setSearch({ availability: next.length > 0 ? next : undefined });
  };

  return (
    <div className="flex flex-col gap-5">
      <FilterGroup label="SHOWING">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            pressed={!!search.open}
            onPressedChange={() => setSearch({ open: search.open ? undefined : true })}
          >
            OPEN TO WORK
          </FilterChip>
        </div>
      </FilterGroup>

      {/* Any of these rather than one of them — "full-time or part-time"
          is a question people actually have, so chips, not a segmented row. */}
      <FilterGroup label="AVAILABILITY">
        <div className="flex flex-wrap gap-1.5">
          {AVAILABILITY_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              pressed={availability.includes(option.value)}
              onPressedChange={() => toggleAvailability(option.value)}
            >
              {option.label}
            </FilterChip>
          ))}
        </div>
      </FilterGroup>

      {/* A ceiling, so exactly one — "under $50" already contains
          "under $25". Tapping the pressed band clears it. */}
      <FilterGroup label="HOURLY RATE">
        <div className="flex flex-wrap gap-1.5">
          {RATE_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              pressed={search.rate === option.value}
              onPressedChange={() =>
                setSearch({ rate: search.rate === option.value ? undefined : option.value })
              }
            >
              {option.label}
            </FilterChip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="ROLE">
        <MembersRolePicker search={search} setSearch={setSearch} inline />
      </FilterGroup>

      <FilterGroup label="SKILLS">
        <MembersSkillPicker search={search} setSearch={setSearch} inline />
      </FilterGroup>

      {/* A window, so exactly one — "within ±6h" already contains "±3h".
          Tapping the pressed band clears it. */}
      <FilterGroup label="TIMEZONE">
        <div className="flex flex-wrap gap-1.5">
          {TZ_OPTIONS.map((option) => (
            <FilterChip
              key={option.value}
              pressed={search.tz === option.value}
              onPressedChange={() =>
                setSearch({ tz: search.tz === option.value ? undefined : option.value })
              }
            >
              {option.label}
            </FilterChip>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="SORT BY">
        <SegmentedControl
          value={search.sort ?? DEFAULT_SORT}
          onChange={(v) => setSearch({ sort: v === DEFAULT_SORT ? undefined : (v as MembersSort) })}
          size="sm"
        >
          {SORT_OPTIONS.map((option) => (
            <SegmentedControl.Item key={option.value} value={option.value}>
              {option.short}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </FilterGroup>

      {/* CLEAR lives up in the drawer header beside the title; this row
          is the confirm alone, sized as the panel's primary action. */}
      {onDone ? (
        <Button
          variant="default"
          size="lg"
          onClick={onDone}
          className="h-12 w-full text-sm tracking-widest"
        >
          {resultCount === null
            ? "SHOW RESULTS"
            : `SHOW ${resultCount} MEMBER${resultCount === 1 ? "" : "S"}`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * CLEAR ALL for the filter drawer's header. Greys out when there's
 * nothing to clear — sort isn't a constraint, so it survives.
 */
export function MembersFilterClearButton({
  search,
  setSearch,
}: {
  search: MembersSearch;
  setSearch: SetMembersSearch;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setSearch(CLEARED_MEMBER_FILTERS)}
      disabled={countActiveMemberFilters(search) === 0}
      className="tracking-widest text-muted-foreground"
    >
      CLEAR
    </Button>
  );
}

function FilterChip({
  pressed,
  onPressedChange,
  children,
}: {
  pressed: boolean;
  onPressedChange: () => void;
  children: React.ReactNode;
}) {
  return (
    <Toggle
      variant="outline"
      size="sm"
      pressed={pressed}
      onPressedChange={onPressedChange}
      className={cn(
        "rounded bg-background px-2.5 text-xs tracking-widest uppercase dark:bg-emboss-surface",
        pressed && "border-primary/50 text-primary",
      )}
    >
      {children}
    </Toggle>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Text as="span" size="xs" variant="muted" className="tracking-widest text-foreground/80">
        {label}
      </Text>
      {children}
    </div>
  );
}
