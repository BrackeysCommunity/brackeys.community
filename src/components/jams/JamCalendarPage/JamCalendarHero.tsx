import { ArrowDataTransferHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Chonk } from "@/components/ui/chonk";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

import type { ViewMode } from "./helpers";
import type { StatKey } from "./shared-types";

interface JamCalendarHeroProps {
  totalJams: number;
  stats: Record<StatKey, number>;
  /** Lay out the stat tiles inline with the title (desktop), stacked
   * below it, or hide them entirely (touch / mobile). */
  statsLayout: "inline" | "stacked" | "hidden";
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  /** Tile click — jumps to the matching board shelf / archive view. */
  onStatClick: (k: StatKey) => void;
}

const VIEW_ORDER: ViewMode[] = ["board", "calendar", "archive"];

const VIEW_WORD: Record<ViewMode, string> = {
  board: "BOARD",
  calendar: "CALENDAR",
  archive: "ARCHIVE",
};

const TILES: { key: StatKey; label: string }[] = [
  { key: "upcoming", label: "UPCOMING" },
  { key: "live", label: "LIVE NOW" },
  { key: "voting", label: "VOTING" },
  { key: "archive", label: "ARCHIVE" },
];

export function JamCalendarHero({
  totalJams,
  stats,
  statsLayout,
  view,
  onViewChange,
  onStatClick,
}: JamCalendarHeroProps) {
  const nextView = VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length]!;

  return (
    <div
      className={
        statsLayout === "inline"
          ? "flex flex-wrap items-end justify-between gap-6"
          : "flex flex-col gap-6"
      }
    >
      <div className="flex flex-col gap-3">
        <Heading
          as="h1"
          className="flex flex-wrap items-center text-[clamp(2.5rem,8vw,5rem)] leading-none tracking-tight"
        >
          <span>
            JAM<span className="text-accent">.</span>
          </span>
          <button
            type="button"
            onClick={() => onViewChange(nextView)}
            aria-label={`Switch to ${VIEW_WORD[nextView].toLowerCase()} view`}
            className="group -ml-[0.15em] inline-flex cursor-pointer items-center gap-[0.4em] rounded-md px-[0.2em] underline decoration-accent/40 decoration-[0.06em] underline-offset-[0.06em] transition-colors hover:decoration-accent focus-visible:bg-accent/10 focus-visible:outline-none"
          >
            {VIEW_WORD[view]}
            <HugeiconsIcon
              icon={ArrowDataTransferHorizontalIcon}
              className="h-[0.5em] w-[0.5em] text-accent transition-transform group-hover:scale-110"
            />
          </button>
        </Heading>
        <Text as="p" size="md" variant="muted" className="max-w-prose">
          Tracking {totalJams.toLocaleString()} jams across itch.io.{" "}
          {view === "board" && (
            <>
              Ranked by who's actually joining: <InlineCode variant="destructive">live</InlineCode>{" "}
              first, then <InlineCode variant="primary">upcoming</InlineCode> and{" "}
              <InlineCode variant="warning">voting</InlineCode>. The long tail of small jams sits
              behind each shelf's fold — search reaches everything.
            </>
          )}
          {view === "calendar" && (
            <>The biggest jams drawn as bars across each week. Click any day for the full list.</>
          )}
          {view === "archive" && (
            <>
              Every finished jam. Sort by entries, ratings, length, or date — click a row for
              details.
            </>
          )}
        </Text>
      </div>
      {statsLayout !== "hidden" && (
        <div
          className={
            statsLayout === "inline"
              ? "grid auto-cols-fr grid-flow-col gap-2"
              : "grid grid-cols-2 gap-2 sm:grid-cols-4"
          }
        >
          {TILES.map((tile) => (
            <Chonk
              key={tile.key}
              variant="surface"
              size="lg"
              render={<button type="button" />}
              onClick={() => onStatClick(tile.key)}
              aria-label={`Jump to ${tile.label.toLowerCase()}`}
              className="flex min-w-28 cursor-pointer flex-col justify-between gap-2 overflow-hidden px-4 py-3 text-left"
            >
              <GraphPaper fade="bottom-right" fadeStop="90%" size={12} />
              <Text as="div" size="sm" density="dense" className="relative tracking-wide">
                {tile.label}
              </Text>
              <Text
                as="div"
                bold
                variant="accent"
                density="dense"
                align="right"
                className="relative text-2xl tabular-nums"
              >
                {stats[tile.key]}
              </Text>
            </Chonk>
          ))}
        </div>
      )}
    </div>
  );
}
