import { motion } from "framer-motion";

import { JamWatchMarker } from "@/components/jams/JamWatchMarker";
import { Text } from "@/components/ui/typography";

import type { JamFromList } from "../helpers";
import { JamBanner } from "./BannerMedia";
import { HostLine } from "./HostLine";
import { RowProgress } from "./JamProgress";
import { LifecycleDates, MilestoneHeadline } from "./milestones";
import { CountStat, SignalInline } from "./SignalStat";
import { ROW_CLOSE_TRANSITION } from "./transitions";
import { useJamColor } from "./use-jam-color";

/**
 * Dense list rendering of a jam: thumb, title/host, lifecycle dates, and
 * a right rail stacking participation counts above the countdown badge.
 * The row background is a flat wash of the jam's theme color —
 * deliberately not the banner image again; a blurred full-bleed copy of
 * every thumb doubled the image decode/paint cost of the list for pure
 * atmosphere.
 */
export function ShelfRow({
  jam,
  now,
  layoutKey,
  isSelected,
  onSelect,
}: {
  jam: JamFromList;
  now: Date;
  layoutKey: string;
  /** Hidden while its modal is open so framer's shared-layout morph has
   * a single visible instance. */
  isSelected: boolean;
  onSelect: () => void;
}) {
  const rowColor = useJamColor(jam);
  const entries = jam.entriesCount ?? 0;

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      layoutId={`tl-row-${layoutKey}`}
      layout={false}
      transition={ROW_CLOSE_TRANSITION}
      style={{ opacity: isSelected ? 0 : 1 }}
      className="group relative block w-full cursor-pointer overflow-hidden text-left transition-colors"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `color-mix(in srgb, ${rowColor} 9%, transparent)` }}
      />
      <RowProgress jam={jam} now={now} />
      {/* The thumb column bleeds to the row's top/bottom/left edges, so
          the row itself carries no left or vertical padding — the text
          and stat columns pad themselves instead. */}
      <div className="relative grid grid-cols-[7rem_minmax(0,1fr)] items-stretch gap-4 pr-3 transition-colors group-hover:bg-muted/20 sm:grid-cols-[11rem_minmax(0,1fr)_auto]">
        <div
          className="relative h-full min-h-16 w-full shrink-0 overflow-hidden"
          style={{ backgroundColor: rowColor }}
        >
          <JamBanner jam={jam} layoutKey={layoutKey} />
        </div>
        <div className="flex min-w-0 flex-col justify-center gap-1.5 py-2.5">
          {/* Countdown and count ride with the title on narrow screens;
              on sm+ they move to the right rail. */}
          <div className="flex flex-wrap items-center gap-2 sm:hidden">
            <MilestoneHeadline jam={jam} now={now} compact />
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <Text bold size="lg" className="truncate leading-snug whitespace-nowrap">
              {jam.title}
            </Text>
            <JamWatchMarker jamId={jam.jamId} className="shrink-0" />
          </div>
          <HostLine jam={jam} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LifecycleDates jam={jam} now={now} />
            <span className="sm:hidden">
              <SignalInline jam={jam} now={now} />
            </span>
          </div>
        </div>
        {/* Counts read top-down as the jam progresses (joined → entries),
            with the live countdown anchored at the bottom edge. */}
        <div className="hidden flex-col items-end py-2.5 sm:flex">
          {/* The counts read as one block, so they stack tight; the
              countdown is pushed to the bottom edge. */}
          <div className="flex flex-col items-end leading-tight">
            {jam.joinedCount != null && jam.joinedCount > 0 && (
              <CountStat value={jam.joinedCount} label="JOINED" size="md" bold={false} />
            )}
            {entries > 0 && (
              <CountStat
                value={entries}
                label={entries === 1 ? "ENTRY" : "ENTRIES"}
                size="md"
                bold={false}
              />
            )}
          </div>
          <MilestoneHeadline jam={jam} now={now} compact className="mt-auto" />
        </div>
      </div>
    </motion.button>
  );
}
