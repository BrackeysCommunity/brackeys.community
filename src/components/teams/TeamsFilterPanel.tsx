import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import {
  CLEARED_TEAM_FILTERS,
  countActiveTeamFilters,
  DEFAULT_SORT,
  type SetTeamsSearch,
  SORT_OPTIONS,
  type TeamsSearch,
  type TeamsSort,
} from "./teams-filters";

/** Skill chips shown before the user narrows with search. */
const VISIBLE_SKILL_CHIPS = 18;

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
  const skillIds = search.skills ?? [];

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
        <SkillFilterChips
          selected={skillIds}
          onChange={(next) => setSearch({ skills: next.length > 0 ? next : undefined })}
        />
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

function SkillFilterChips({
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
  const skills = data ?? [];
  if (skills.length === 0) return null;

  // Selected chips first so a long vocabulary never hides the active
  // constraint below the fold.
  const ordered = [
    ...skills.filter((s) => selected.includes(s.id)),
    ...skills.filter((s) => !selected.includes(s.id)).slice(0, VISIBLE_SKILL_CHIPS),
  ];

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((skill) => (
        <FilterChip
          key={skill.id}
          pressed={selected.includes(skill.id)}
          onPressedChange={() => toggle(skill.id)}
        >
          {skill.name}
        </FilterChip>
      ))}
    </div>
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
