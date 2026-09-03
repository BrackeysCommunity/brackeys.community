import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Text } from "@/components/ui/typography";
import {
  type CollabCompensationType,
  type CollabPostType,
  type CollabStatus,
} from "@/lib/collab-store";
import { orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

import {
  type CollabBoardSearch,
  type CollabBoardSort,
  CLEARED_COLLAB_FILTERS,
  countActiveCollabFilters,
  DEFAULT_SORT,
  useCollabBoardSearch,
} from "./collab-filters";
import { posterToSolo, RoleFilterMenu, soloToPoster, StackFilterMenu } from "./CollabToolbar";
import { useCollabResultCount, useCollabTypeCounts } from "./use-collab-counts";

// SegmentedControl is single-select, so the optional filters use
// sentinel "all" / "any" values and translate to/from `undefined` when
// reading and writing the URL.
const TYPE_OPTIONS = [
  { value: "all", label: "ALL" },
  { value: "paid", label: "PAID WORK" },
  { value: "hobby", label: "HOBBY" },
] as const;

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

const POSTER_OPTIONS = [
  { value: "all", label: "ANYONE" },
  { value: "solo", label: "SOLO" },
  { value: "team", label: "HAS A CREW" },
] as const;

// Sort presets pair a column with a direction, mirroring the toolbar's
// sort menu.
const SORT_OPTIONS = [
  { value: "newest", label: "NEWEST" },
  { value: "oldest", label: "OLDEST" },
  { value: "active", label: "ACTIVE" },
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
  const { search, setSearch } = useCollabBoardSearch();
  const { data: counts } = useCollabTypeCounts();
  const resultCount = useCollabResultCount();

  return (
    <div className="flex flex-col gap-5">
      <FilterGroup label="POST TYPE">
        <PostTypeRow value={search.type ?? "all"} options={TYPE_OPTIONS} counts={counts} />
      </FilterGroup>

      {search.jam !== undefined ? (
        <FilterGroup label="JAM">
          <JamFilterChip jamId={search.jam} />
        </FilterGroup>
      ) : null}

      <FilterGroup label="ROLE">
        <RoleFilterMenu selected={search.roles ?? []} inline />
      </FilterGroup>

      <FilterGroup label="STATUS">
        <SegmentedControl
          value={search.status ?? "any"}
          onChange={(v) => setSearch({ status: v === "any" ? undefined : (v as CollabStatus) })}
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
          value={search.level ?? "any"}
          onChange={(v) =>
            setSearch({
              level: v === "any" ? undefined : (v as CollabBoardSearch["level"]),
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

      {search.type === "paid" ? (
        <FilterGroup label="COMPENSATION">
          <SegmentedControl
            value={search.comp ?? "all"}
            onChange={(v) =>
              setSearch({
                comp: v === "all" ? undefined : (v as CollabCompensationType),
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

      <FilterGroup label="POSTED BY">
        <SegmentedControl
          value={soloToPoster(search.solo)}
          onChange={(v) => setSearch({ solo: posterToSolo(v as string) })}
          size="sm"
        >
          {POSTER_OPTIONS.map((p) => (
            <SegmentedControl.Item key={p.value} value={p.value}>
              {p.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </FilterGroup>

      <FilterGroup label="TECH STACK">
        <StackFilterMenu selected={search.skills ?? []} inline />
      </FilterGroup>

      <FilterGroup label="SORT BY">
        <SegmentedControl
          value={search.sort ?? DEFAULT_SORT}
          onChange={(v) =>
            setSearch({ sort: v === DEFAULT_SORT ? undefined : (v as CollabBoardSort) })
          }
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
  const { search, setSearch } = useCollabBoardSearch();
  const active = countActiveCollabFilters(search);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setSearch(CLEARED_COLLAB_FILTERS)}
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
  const { setSearch } = useCollabBoardSearch();
  const { data } = useQuery({
    ...orpc.listJams.queryOptions({ input: { filter: "board", limit: 500 } }),
    staleTime: STALE.jam,
  });
  const jam = data?.jams.find((j) => j.jamId === jamId);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setSearch({ jam: undefined })}
      className="self-start border-primary/50 tracking-widest text-primary"
    >
      {jam?.title ?? `JAM #${jamId}`} ×
    </Button>
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
  const { setSearch } = useCollabBoardSearch();
  return (
    <SegmentedControl
      value={value}
      onChange={(v) => setSearch({ type: v === "all" ? undefined : (v as CollabPostType) })}
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
