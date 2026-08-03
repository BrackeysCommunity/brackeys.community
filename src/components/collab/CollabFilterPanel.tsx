import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Toggle } from "@/components/ui/toggle";
import { Text } from "@/components/ui/typography";
import {
  type CollabCompensationType,
  type CollabExperienceLevel,
  type CollabPostType,
  type CollabSortBy,
  type CollabSortOrder,
  type CollabStatus,
  collabStore,
  countActiveCollabFilters,
  resetCollabFilters,
  setCollabFilters,
} from "@/lib/collab-store";
import { cn } from "@/lib/utils";
import { orpc } from "@/orpc/client";

import { useCollabResultCount, useCollabTypeCounts } from "./use-collab-counts";

// SegmentedControl is single-select, so the optional filters use
// sentinel "all" / "any" values and translate to/from `undefined` when
// reading and writing the store.
const TYPE_OPTIONS = [
  { value: "all", label: "ALL" },
  { value: "paid", label: "PAID WORK" },
  { value: "hobby", label: "HOBBY" },
] as const;

/** Skill chips shown before the user narrows with search. */
const VISIBLE_SKILL_CHIPS = 18;

const STATUS_OPTIONS = [
  { value: "any", label: "ANY" },
  { value: "recruiting", label: "OPEN" },
  { value: "party_full", label: "CLOSED" },
] as const;

const EXPERIENCE_OPTIONS = [
  { value: "any", label: "ANY" },
  { value: "beginner", label: "BEGINNER" },
  { value: "intermediate", label: "INTER." },
  { value: "experienced", label: "EXPERT" },
] as const;

const COMP_OPTIONS = [
  { value: "all", label: "ALL" },
  { value: "hourly", label: "HOURLY" },
  { value: "fixed", label: "FIXED" },
  { value: "rev_share", label: "REV" },
  { value: "negotiable", label: "NEGOT." },
] as const;

// Sort presets pair a column with a direction, mirroring the toolbar's
// sort menu — the value encodes both halves.
const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "NEWEST" },
  { value: "createdAt:asc", label: "OLDEST" },
  { value: "updatedAt:desc", label: "ACTIVE" },
] as const;

interface CollabFilterPanelProps {
  /** Closes the mobile sheet — also drives the result-count CTA. */
  onDone?: () => void;
}

/**
 * Full filter set for the mobile sheet. On desktop these same controls
 * live in `CollabToolbar`; here they get room to breathe as segmented
 * rows, and the confirm button carries the live result count so you
 * know what you're about to see before dismissing the sheet.
 */
export function CollabFilterPanel({ onDone }: CollabFilterPanelProps) {
  const filters = useStore(collabStore, (s) => s.filters);
  const { data: counts } = useCollabTypeCounts();
  const resultCount = useCollabResultCount();

  return (
    <div className="flex flex-col gap-5">
      <FilterGroup label="POST TYPE">
        <PostTypeRow value={filters.type ?? "all"} options={TYPE_OPTIONS} counts={counts} />
      </FilterGroup>

      {filters.jamId !== undefined ? (
        <FilterGroup label="JAM">
          <JamFilterChip jamId={filters.jamId} />
        </FilterGroup>
      ) : null}

      <FilterGroup label="STATUS">
        <SegmentedControl
          value={filters.status ?? "any"}
          onChange={(v) =>
            setCollabFilters({ status: v === "any" ? undefined : (v as CollabStatus) })
          }
          size="sm"
        >
          {STATUS_OPTIONS.map((s) => (
            <SegmentedControl.Item key={s.value} value={s.value}>
              {s.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </FilterGroup>

      <FilterGroup label="EXPERIENCE LEVEL">
        <SegmentedControl
          value={filters.experienceLevel ?? "any"}
          onChange={(v) =>
            setCollabFilters({
              experienceLevel: v === "any" ? undefined : (v as CollabExperienceLevel),
            })
          }
          size="sm"
        >
          {EXPERIENCE_OPTIONS.map((e) => (
            <SegmentedControl.Item key={e.value} value={e.value}>
              {e.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </FilterGroup>

      {filters.type === "paid" ? (
        <FilterGroup label="COMPENSATION">
          <SegmentedControl
            value={filters.compensationType ?? "all"}
            onChange={(v) =>
              setCollabFilters({
                compensationType: v === "all" ? undefined : (v as CollabCompensationType),
              })
            }
            size="sm"
          >
            {COMP_OPTIONS.map((c) => (
              <SegmentedControl.Item key={c.value} value={c.value}>
                {c.label}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl>
        </FilterGroup>
      ) : null}

      <FilterGroup label="TECH STACK">
        <SkillFilterChips selected={filters.skillIds} />
      </FilterGroup>

      <FilterGroup label="SORT BY">
        <SegmentedControl
          value={`${filters.sortBy}:${filters.sortOrder}`}
          onChange={(v) => {
            const [sortBy, sortOrder] = (v as string).split(":");
            setCollabFilters({
              sortBy: sortBy as CollabSortBy,
              sortOrder: sortOrder as CollabSortOrder,
            });
          }}
          size="sm"
        >
          {SORT_OPTIONS.map((s) => (
            <SegmentedControl.Item key={s.value} value={s.value}>
              {s.label}
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
            : `SHOW ${resultCount} POST${resultCount === 1 ? "" : "S"}`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * CLEAR ALL for the filter drawer's header. Subscribes on its own so
 * the page hosting the drawer doesn't re-render on every filter change,
 * and greys out when there's nothing to clear.
 */
export function CollabFilterClearButton() {
  const filters = useStore(collabStore, (s) => s.filters);
  const active = countActiveCollabFilters(filters);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={resetCollabFilters}
      disabled={active === 0}
      className="tracking-widest text-muted-foreground"
    >
      CLEAR
    </Button>
  );
}

/**
 * The jam constraint, when there is one. Not a picker: a jam filter
 * always arrives from somewhere (a jam's "N team posts" link, a post's
 * jam chip), so this only has to name it and let you drop it.
 */
function JamFilterChip({ jamId }: { jamId: number }) {
  const { data } = useQuery({
    ...orpc.listJams.queryOptions({ input: { filter: "board", limit: 500 } }),
    staleTime: 5 * 60 * 1000,
  });
  const jam = data?.jams.find((j) => j.jamId === jamId);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setCollabFilters({ jamId: undefined })}
      className="self-start border-primary/50 tracking-widest text-primary"
    >
      {jam?.title ?? `JAM #${jamId}`} ×
    </Button>
  );
}

function SkillFilterChips({ selected }: { selected: number[] }) {
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
    setCollabFilters({
      skillIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    });

  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((skill) => {
        const active = selected.includes(skill.id);
        return (
          <Toggle
            key={skill.id}
            variant="outline"
            size="sm"
            pressed={active}
            onPressedChange={() => toggle(skill.id)}
            className={cn(
              "rounded bg-background px-2.5 text-xs tracking-widest dark:bg-emboss-surface",
              active && "border-primary/50 text-primary",
            )}
          >
            {skill.name}
          </Toggle>
        );
      })}
    </div>
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

function PostTypeRow({
  value,
  options,
  counts,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  counts: Record<string, number> | undefined;
}) {
  return (
    <SegmentedControl
      value={value}
      onChange={(v) => setCollabFilters({ type: v === "all" ? undefined : (v as CollabPostType) })}
      size="sm"
    >
      {options.map((t) => {
        const n = counts?.[t.value];
        return (
          <SegmentedControl.Item
            key={t.value}
            value={t.value}
            disabled={t.value !== "all" && n === 0 && value !== t.value}
          >
            {t.label}
            <span className="ml-0.5 tabular-nums opacity-60">{n ?? ""}</span>
          </SegmentedControl.Item>
        );
      })}
    </SegmentedControl>
  );
}
