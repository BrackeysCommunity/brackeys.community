import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import {
  type CollabCompensationType,
  type CollabExperienceLevel,
  type CollabPostType,
  type CollabStatus,
  collabStore,
  setCollabFilters,
} from "@/lib/collab-store";

// SegmentedControl is single-select, so we use sentinel "all" / "any"
// values for the optional filters and translate to/from `undefined`
// when reading and writing the store.
type TypeValue = "all" | CollabPostType;
type StatusValue = "any" | CollabStatus;
type ExperienceValue = CollabExperienceLevel; // already includes "any"
type CompValue = "all" | CollabCompensationType;

// Splitting the post-type row into a 3+2 stack keeps each
// SegmentedControl narrow enough to fit the sidebar without overflow.
const TYPE_OPTIONS_ROW_1: { value: TypeValue; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "paid", label: "PAID WORK" },
  { value: "hobby", label: "HOBBY" },
];
const TYPE_OPTIONS_ROW_2: { value: TypeValue; label: string }[] = [
  { value: "playtest", label: "PLAYTEST" },
  { value: "mentor", label: "MENTOR" },
];

const STATUS_OPTIONS: { value: StatusValue; label: string }[] = [
  { value: "any", label: "ANY" },
  { value: "recruiting", label: "OPEN" },
  { value: "party_full", label: "CLOSED" },
];

const EXPERIENCE_OPTIONS: { value: ExperienceValue; label: string }[] = [
  { value: "any", label: "ANY" },
  { value: "beginner", label: "BEGINNER" },
  { value: "intermediate", label: "INTER." },
  { value: "experienced", label: "EXPERT" },
];

const COMP_OPTIONS: { value: CompValue; label: string }[] = [
  { value: "all", label: "ALL" },
  { value: "hourly", label: "HOURLY" },
  { value: "fixed", label: "FIXED" },
  { value: "rev_share", label: "REV" },
  { value: "negotiable", label: "NEGOT." },
];

interface CollabFilterPanelProps {
  /** Mobile sheet variant — renders a "DONE" button at the bottom. */
  onDone?: () => void;
}

export const COLLAB_SEARCH_INPUT_ID = "collab-filter-search";

export function CollabFilterPanel({ onDone }: CollabFilterPanelProps) {
  const { filters } = useStore(collabStore);
  const [searchInput, setSearchInput] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCollabFilters({ search: searchInput });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // When `filters.search` is reset from outside the panel (e.g. the
  // §01 header's clear action calls `resetCollabFilters()`), pull the
  // change back into the local debounced input so the field clears.
  useEffect(() => {
    setSearchInput((current) => (current === filters.search ? current : filters.search));
  }, [filters.search]);

  return (
    <div className="flex flex-col gap-5">
      <SearchField
        id={COLLAB_SEARCH_INPUT_ID}
        value={searchInput}
        onChange={setSearchInput}
        placeholder="Search posts, projects, devs…"
        containerClassName="dark:bg-emboss-surface!"
      />

      <FilterGroup label="SHOW">
        <SegmentedControl
          value={filters.listingType === "people" ? "people" : "posts"}
          onChange={(v) => setCollabFilters({ listingType: v as "posts" | "people" })}
          size="sm"
        >
          <SegmentedControl.Item value="posts">PROJECTS</SegmentedControl.Item>
          <SegmentedControl.Item value="people">PEOPLE</SegmentedControl.Item>
        </SegmentedControl>
      </FilterGroup>

      <FilterGroup label="POST TYPE">
        {/* Two stacked SegmentedControls share the same selected value
            (`filters.type ?? "all"`) — only one item is pressed across
            both rows because the values are unique. Splitting like this
            keeps each row's rounded ends intact instead of forcing the
            single-row control to overflow in a narrow rail. */}
        <PostTypeRow value={filters.type ?? "all"} options={TYPE_OPTIONS_ROW_1} />
        <PostTypeRow value={filters.type ?? "all"} options={TYPE_OPTIONS_ROW_2} />
      </FilterGroup>

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

      <FilterGroup label="COMMITMENT">
        <SegmentedControl
          value={filters.experienceLevel ?? "any"}
          onChange={(v) => setCollabFilters({ experienceLevel: v as CollabExperienceLevel })}
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

      <Well className="gap-1.5 p-3">
        <Text size="sm" variant="muted" className="flex flex-wrap items-center gap-1.5">
          Press <Kbd>/</Kbd> to focus search.
        </Text>
        <Text size="sm" variant="muted" className="flex flex-wrap items-center gap-1.5">
          Press <Kbd>P</Kbd> to toggle people view.
        </Text>
      </Well>

      {onDone ? (
        <Button
          variant="default"
          size="sm"
          onClick={onDone}
          className="w-full font-mono tracking-widest"
        >
          DONE
        </Button>
      ) : null}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <FilterGroupLabel>{label}</FilterGroupLabel>
      {children}
    </div>
  );
}

function PostTypeRow({
  value,
  options,
}: {
  value: TypeValue;
  options: { value: TypeValue; label: string }[];
}) {
  return (
    <SegmentedControl
      value={value}
      onChange={(v) => setCollabFilters({ type: v === "all" ? undefined : (v as CollabPostType) })}
      size="sm"
    >
      {options.map((t) => (
        <SegmentedControl.Item key={t.value} value={t.value}>
          {t.label}
        </SegmentedControl.Item>
      ))}
    </SegmentedControl>
  );
}

function FilterGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      as="span"
      monospace
      size="xs"
      variant="muted"
      className="tracking-widest text-foreground/80"
    >
      {children}
    </Text>
  );
}
