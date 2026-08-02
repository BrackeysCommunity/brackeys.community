import { LayoutGroup, motion } from "framer-motion";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { durationDays } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";

import { ROW_CLOSE_TRANSITION } from "./board/transitions";
import type { JamFromList } from "./helpers";
import { JamDetailModal } from "./JamDetailModal";
import {
  ARCHIVE_PAGE_SIZE,
  type ArchiveData,
  type ArchiveQueryState,
  type ArchiveSortKey,
} from "./use-jam-data";

interface JamArchiveTableProps {
  data: ArchiveData;
  state: ArchiveQueryState;
  onStateChange: (next: Partial<ArchiveQueryState>) => void;
}

const COLUMNS: { key: ArchiveSortKey | null; label: string; className?: string }[] = [
  { key: "title", label: "JAM" },
  { key: null, label: "HOST", className: "hidden md:table-cell" },
  { key: "lastEvent", label: "ENDED" },
  { key: "duration", label: "LENGTH", className: "hidden sm:table-cell" },
  { key: "entries", label: "ENTRIES", className: "text-right" },
  { key: "ratings", label: "RATINGS", className: "hidden text-right sm:table-cell" },
];

/**
 * The archive is a research surface, not a discovery one — ~19k past
 * jams get a dense, sortable, server-paginated table instead of banner
 * rows. Sorting and search run in the database; the client only ever
 * holds one page.
 */
export function JamArchiveTable({ data, state, onStateChange }: JamArchiveTableProps) {
  const [selected, setSelected] = useState<JamFromList | null>(null);
  const totalPages = Math.max(1, Math.ceil(data.total / ARCHIVE_PAGE_SIZE));

  const toggleSort = (key: ArchiveSortKey) => {
    if (state.sortBy === key) {
      onStateChange({ sortDir: state.sortDir === "desc" ? "asc" : "desc", page: 0 });
    } else {
      // Fresh sort key: text ascending, numbers/dates descending.
      onStateChange({ sortBy: key, sortDir: key === "title" ? "asc" : "desc", page: 0 });
    }
  };

  if (data.isLoading) {
    return (
      <Well className="flex flex-col gap-2 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded" />
        ))}
      </Well>
    );
  }

  return (
    <LayoutGroup>
      <div className="flex flex-col gap-3">
        <Well className="overflow-hidden">
          <Table className={cn("transition-opacity", data.isFetching && "opacity-60")}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {COLUMNS.map((col) => (
                  <TableHead key={col.label} className={col.className}>
                    {col.key ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key!)}
                        className={cn(
                          "cursor-pointer text-[10px] tracking-widest uppercase transition-colors hover:text-foreground",
                          state.sortBy === col.key ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {col.label}
                        {state.sortBy === col.key && (
                          <span aria-hidden className="ml-1 text-accent">
                            {state.sortDir === "desc" ? "▼" : "▲"}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                        {col.label}
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.jams.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length}>
                    <Text
                      as="div"
                      size="sm"
                      variant="muted"
                      align="center"
                      className="p-8 tracking-widest uppercase"
                    >
                      No archived jams match
                    </Text>
                  </TableCell>
                </TableRow>
              ) : (
                data.jams.map((jam) => (
                  // `motion.tr` rather than `TableRow` so the row can be
                  // the shared-layout source the spotlight grows out of —
                  // same `tl-row-` contract the board and calendar use.
                  // `layout={false}` keeps that morph while opting out of
                  // self-layout animation, so paging and sorting swap rows
                  // instantly instead of springing them.
                  <motion.tr
                    key={jam.jamId}
                    data-slot="table-row"
                    layoutId={`tl-row-arch-${jam.jamId}`}
                    layout={false}
                    transition={ROW_CLOSE_TRANSITION}
                    onClick={() => setSelected(jam)}
                    // Hide the source row for the duration of the morph:
                    // framer projects the follow element onto the lead's
                    // box, and a `<tr>` scaled to modal size would spill
                    // its cells across the table.
                    style={{ opacity: selected?.jamId === jam.jamId ? 0 : 1 }}
                    className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                  >
                    <TableCell className="max-w-64 truncate font-medium">{jam.title}</TableCell>
                    <TableCell className="hidden max-w-40 truncate text-muted-foreground md:table-cell">
                      {jam.hosts[0]?.name ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatArchiveDate(jam)}
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {durationDays(jam.startsAt, jam.endsAt) ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(jam.entriesCount ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {(jam.ratingsCount ?? 0).toLocaleString()}
                    </TableCell>
                  </motion.tr>
                ))
              )}
            </TableBody>
          </Table>
        </Well>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Text size="xs" variant="muted" className="tracking-widest tabular-nums">
            {data.total.toLocaleString()} ARCHIVED JAM{data.total === 1 ? "" : "S"}
          </Text>
          <div className="flex items-center gap-2">
            <ButtonGroup className="[&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md">
              <Button
                variant="outline"
                size="sm"
                disabled={state.page === 0}
                onClick={() => onStateChange({ page: state.page - 1 })}
                className="px-2.5 text-[11px] tracking-widest"
              >
                ‹ PREV
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={state.page >= totalPages - 1}
                onClick={() => onStateChange({ page: state.page + 1 })}
                className="px-2.5 text-[11px] tracking-widest"
              >
                NEXT ›
              </Button>
            </ButtonGroup>
            <Text size="xs" variant="muted" className="tracking-widest tabular-nums">
              PAGE {state.page + 1}/{totalPages}
            </Text>
          </div>
        </div>

        <JamDetailModal
          jam={selected}
          layoutKey={selected ? `arch-${selected.jamId}` : null}
          onClose={() => setSelected(null)}
        />
      </div>
    </LayoutGroup>
  );
}

/** The date that matters in the archive: when the jam's last event
 * happened, with the year (archives span years). */
function formatArchiveDate(jam: JamFromList): string {
  const last = jam.votingEndsAt ?? jam.endsAt ?? jam.startsAt;
  if (!last) return "—";
  return new Date(last)
    .toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
}
