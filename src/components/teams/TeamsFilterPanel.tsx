import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import {
  CLEARED_TEAM_FILTERS,
  countActiveTeamFilters,
  DEFAULT_SORT,
  type SetTeamsSearch,
  SORT_OPTIONS,
  type TeamsSearch,
  type TeamsSort,
} from "./teams-filters";
import { TeamsSkillPicker } from "./TeamsSkillPicker";

interface TeamsFilterPanelProps {
  search: TeamsSearch;
  setSearch: SetTeamsSearch;
  /** Live match count for the confirm button; `null` while loading. */
  resultCount: number | null;
  /** Closes the mobile sheet — also drives the result-count CTA. */
  onDone?: () => void;
}

/**
 * Full filter set for the mobile sheet. On wide screens these same
 * controls live in `TeamsToolbar`; here they get room to breathe as
 * chip and segmented rows, and the confirm button carries the live
 * result count so you know what you're about to see before dismissing
 * the sheet. The collab board's drawer is the same panel for its own
 * filters — one filtering idiom across both boards.
 */
export function TeamsFilterPanel({
  search,
  setSearch,
  resultCount,
  onDone,
}: TeamsFilterPanelProps) {
  return (
    <div className="flex flex-col gap-5">
      {/* Two independent constraints rather than one choice, so chips
          rather than the segmented row the sort uses. */}
      <FilterGroup label="SHOWING">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            pressed={!!search.recruiting}
            onPressedChange={() => setSearch({ recruiting: search.recruiting ? undefined : true })}
          >
            RECRUITING
          </FilterChip>
          <FilterChip
            pressed={!!search.shipped}
            onPressedChange={() => setSearch({ shipped: search.shipped ? undefined : true })}
          >
            HAS SHIPPED
          </FilterChip>
        </div>
      </FilterGroup>

      <FilterGroup label="TECH STACK">
        <TeamsSkillPicker search={search} setSearch={setSearch} inline />
      </FilterGroup>

      <FilterGroup label="SORT BY">
        <SegmentedControl
          value={search.sort ?? DEFAULT_SORT}
          onChange={(v) => setSearch({ sort: v === DEFAULT_SORT ? undefined : (v as TeamsSort) })}
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
            : `SHOW ${resultCount} TEAM${resultCount === 1 ? "" : "S"}`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * CLEAR ALL for the filter drawer's header. Greys out when there's
 * nothing to clear — sort isn't a constraint, so it survives.
 */
export function TeamsFilterClearButton({
  search,
  setSearch,
}: {
  search: TeamsSearch;
  setSearch: SetTeamsSearch;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setSearch(CLEARED_TEAM_FILTERS)}
      disabled={countActiveTeamFilters(search) === 0}
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
