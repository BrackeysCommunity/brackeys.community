import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { SearchField } from "@/components/ui/search-field";
import { Section } from "@/components/ui/section";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { orpc } from "@/orpc/client";

import { JamEntryCard } from "./JamEntryCard";
import type { JamEntryRow } from "./types";

/** Mirrors the server default in `listJamEntries`. */
const PAGE_SIZE = 48;

const SORTS = [
  { value: "rank", label: "RANKED" },
  { value: "ratings", label: "RATINGS" },
  { value: "recent", label: "NEWEST" },
  { value: "title", label: "A–Z" },
] as const;

type SortValue = (typeof SORTS)[number]["value"];

export interface JamEntriesInitialData {
  entries: JamEntryRow[];
  total: number;
}

/**
 * The jam's submissions, paged.
 *
 * A big jam has thousands of entries, so this is a server-paginated grid
 * with server-side search and sort — the same shape as the archive table,
 * for the same reason. Only the first page (default sort, no search) is
 * seeded from the route loader; every other view is a fresh query.
 */
export function JamEntriesSection({
  jamId,
  total,
  initialData,
}: {
  jamId: number;
  /** Entry count from the page loader, so the header has a number before
   * the grid's own query resolves. */
  total: number;
  initialData: JamEntriesInitialData;
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortValue>("rank");
  const [page, setPage] = useState(0);
  const debouncedSearch = useDebouncedValue(search, 300);

  // A new search or sort always shows page 1. Reset at the event rather
  // than in an effect on the derived value: page 8 of the old result set
  // is never a page the new one should land on, and an effect would render
  // it once before correcting itself.
  const changeSearch = (next: string) => {
    setSearch(next);
    setPage(0);
  };
  const changeSort = (next: SortValue) => {
    setSortBy(next);
    setPage(0);
  };

  const input = { jamId, page, pageSize: PAGE_SIZE, sortBy, search: debouncedSearch };
  const isSeeded = page === 0 && sortBy === "rank" && debouncedSearch === "";

  const { data, isLoading, isFetching } = useQuery({
    ...orpc.listJamEntries.queryOptions({ input }),
    // The loader already fetched exactly this page on the server, so the
    // grid renders with the document instead of flashing skeletons.
    initialData: isSeeded ? initialData : undefined,
    staleTime: 60 * 1000,
  });

  const entries = data?.entries ?? [];
  const matched = data?.total ?? total;
  const totalPages = Math.max(1, Math.ceil(matched / PAGE_SIZE));

  // Which of *this page's* games have a canonical project here, so those
  // cards link inward instead of off to itch. Scoped to the page: a project
  // row only exists when something local anchors it, so the answer is
  // usually "none of them" and the query stays a single small `IN`.
  const gameIds = entries.map((entry) => entry.gameId);
  const { data: projectData } = useQuery({
    ...orpc.listProjectsForGames.queryOptions({ input: { gameIds } }),
    enabled: gameIds.length > 0,
    staleTime: 60 * 1000,
  });
  const projectSlugByGameId = new Map(
    (projectData?.projects ?? []).map((project) => [project.sourceGameId, project.slug]),
  );

  return (
    <Section
      id="entries"
      title="SUBMISSIONS"
      // The count is the live *matched* one, so a search says how much it
      // narrowed rather than restating the jam's total.
      blurb={
        matched === total
          ? `${total.toLocaleString()} ${total === 1 ? "entry" : "entries"}.`
          : `${matched.toLocaleString()} of ${total.toLocaleString()} entries.`
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={search}
          onChange={changeSearch}
          placeholder="Search titles and authors…"
          // Full width on a phone: sharing the row with a four-item sort
          // control left the field narrower than its own placeholder.
          containerClassName="w-full min-w-0 sm:w-auto sm:max-w-xs sm:flex-1"
        />
        <SegmentedControl
          value={sortBy}
          onChange={(next) => changeSort(next as SortValue)}
          size="sm"
        >
          {SORTS.map((sort) => (
            <SegmentedControl.Item
              key={sort.value}
              value={sort.value}
              className="tracking-widest"
              // Native `title`, not `SimpleTooltip` — that component renders
              // its own `<button>` trigger, which would nest a button inside
              // this one (same reason `BoardViewControls` uses `title`).
              // Worth saying at all because an unrated jam's "ranked" order is
              // really submission order.
              title={sort.value === "rank" ? "Overall placement, then ratings received" : undefined}
            >
              {sort.label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>

      {isLoading ? (
        <EntriesSkeleton />
      ) : entries.length === 0 ? (
        <Well variant="ghost" className="items-center p-8 backdrop-blur-none">
          <Text size="xs" variant="muted" className="tracking-widest uppercase">
            {debouncedSearch ? "No submissions match" : "No submissions tracked for this jam"}
          </Text>
        </Well>
      ) : (
        <div
          className={`grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 ${
            isFetching ? "opacity-60" : ""
          }`}
        >
          {entries.map((entry) => (
            <JamEntryCard
              key={entry.entryId}
              entry={entry}
              projectSlug={projectSlugByGameId.get(entry.gameId)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <ButtonGroup className="[&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="px-2.5 text-[11px] tracking-widest"
            >
              ‹ PREV
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
              className="px-2.5 text-[11px] tracking-widest"
            >
              NEXT ›
            </Button>
          </ButtonGroup>
          <Text size="xs" variant="muted" className="tracking-widest tabular-nums">
            PAGE {page + 1}/{totalPages}
          </Text>
        </div>
      ) : null}
    </Section>
  );
}

function EntriesSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="aspect-[63/50] w-full rounded" />
          <Skeleton className="h-3 w-3/4 rounded" />
          <Skeleton className="h-2.5 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
