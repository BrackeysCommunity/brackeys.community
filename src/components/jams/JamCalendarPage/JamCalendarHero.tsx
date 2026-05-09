import { ArrowDataTransferHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Chonk } from "@/components/ui/chonk";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

import type { ViewMode } from "./helpers";

interface JamCalendarHeroProps {
  totalJams: number;
  stats: { upcoming: number; live: number; voting: number; archive: number };
  /** Lay out the stat tiles inline with the title (desktop), stacked
   * below it (narrower desktop viewports), or hide them entirely
   * (touch / mobile, where the bottom nav already exposes the relevant
   * counts and screen real estate is at a premium). */
  statsLayout: "inline" | "stacked" | "hidden";
  /** Active surface — drives which copy the description shows
   * (calendar mentions clicking days, timeline mentions browsing the
   * vertical list). */
  view: ViewMode;
  /** Toggling the active surface — clicking the title's view word swaps
   * between calendar and timeline, replacing the standalone toolbar
   * SegmentedControl. */
  onViewChange: (v: ViewMode) => void;
}

interface StatTile {
  label: string;
  value: number;
}

export function JamCalendarHero({
  totalJams,
  stats,
  statsLayout,
  view,
  onViewChange,
}: JamCalendarHeroProps) {
  const otherView: ViewMode = view === "timeline" ? "calendar" : "timeline";
  const tiles: StatTile[] = [
    { label: "UPCOMING", value: stats.upcoming },
    { label: "LIVE NOW", value: stats.live },
    { label: "VOTING", value: stats.voting },
    { label: "ARCHIVE", value: stats.archive },
  ];

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
          monospace
          className="flex flex-wrap items-center text-[clamp(2.5rem,8vw,5rem)] leading-none tracking-tight"
        >
          <span>
            JAM<span className="text-accent">.</span>
          </span>
          <button
            type="button"
            onClick={() => onViewChange(otherView)}
            aria-label={`Switch to ${otherView} view`}
            className="group -ml-[0.15em] inline-flex cursor-pointer items-center gap-[0.4em] rounded-md px-[0.2em] underline decoration-accent/40 decoration-[0.06em] underline-offset-[0.06em] transition-colors hover:decoration-accent focus-visible:bg-accent/10 focus-visible:outline-none"
          >
            {view === "timeline" ? "TIMELINE" : "CALENDAR"}
            <HugeiconsIcon
              icon={ArrowDataTransferHorizontalIcon}
              className="h-[0.5em] w-[0.5em] text-accent transition-transform group-hover:scale-110"
            />
          </button>
        </Heading>
        <Text as="p" size="md" variant="muted" className="max-w-prose">
          Tracking {totalJams} jams across itch.io.{" "}
          {view === "calendar"
            ? "Each day shows badges for jams that "
            : "Each row marks the moment a jam "}
          <InlineCode variant="primary">▶ start{view === "calendar" ? "" : "s"}</InlineCode>, hit
          {view === "calendar" ? "" : "s"} a{" "}
          <InlineCode variant="warning">⊙ submission deadline</InlineCode>, or{" "}
          <InlineCode variant="destructive">
            ■ voting end{view === "calendar" ? "" : "s"}
          </InlineCode>
          {view === "calendar" ? ". Click any day for details." : "."}
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
          {tiles.map((tile) => (
            <Chonk
              key={tile.label}
              variant="surface"
              size="lg"
              className="flex min-w-28 flex-col justify-between gap-2 px-4 py-3"
            >
              <Text
                as="div"
                monospace
                size="xs"
                variant="muted"
                density="dense"
                className="tracking-widest"
              >
                {tile.label}
              </Text>
              <Text
                as="div"
                monospace
                bold
                variant="accent"
                density="dense"
                align="right"
                className="text-2xl tabular-nums"
              >
                {tile.value}
              </Text>
            </Chonk>
          ))}
        </div>
      )}
    </div>
  );
}
