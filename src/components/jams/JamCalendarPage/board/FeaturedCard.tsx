import { motion } from "framer-motion";

import { Text } from "@/components/ui/typography";
import { durationDays, formatJamShortDates } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";

import type { JamFromList } from "../helpers";
import { JamBanner } from "./BannerMedia";
import { HostLine } from "./HostLine";
import { CardProgressStrip } from "./JamProgress";
import { MilestoneHeadline, SUPPORTING_TEXT } from "./milestones";
import { SignalInline } from "./SignalStat";
import { ROW_CLOSE_TRANSITION } from "./transitions";
import { useJamColor } from "./use-jam-color";

/**
 * Slim promo card for the featured carousel — fixed width so the rail
 * scrolls horizontally, shorter banner than a shelf card, one-line
 * title. The participation count rides over the artwork so the text
 * block below stays a clean title / host / dates stack.
 */
export function FeaturedCard({
  jam,
  now,
  layoutKey,
  isSelected,
  onSelect,
}: {
  jam: JamFromList;
  now: Date;
  layoutKey: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const color = useJamColor(jam);
  const dates = formatJamShortDates(jam.startsAt, jam.endsAt);
  const duration = durationDays(jam.startsAt, jam.endsAt);

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      layoutId={`tl-row-${layoutKey}`}
      layout={false}
      transition={ROW_CLOSE_TRANSITION}
      style={{ opacity: isSelected ? 0 : 1, borderRadius: 8 }}
      className="group relative flex w-80 shrink-0 cursor-pointer snap-start flex-col overflow-hidden rounded-lg border border-muted/30 bg-card text-left transition-colors hover:border-muted/60 sm:w-96"
    >
      <div
        className="relative h-52 w-full shrink-0 overflow-hidden"
        style={{ backgroundColor: color }}
      >
        <JamBanner jam={jam} layoutKey={layoutKey} fit="contain" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card/70 to-transparent"
        />
        {/* Over the art rather than in the text block — the count is a
            glanceable badge, not part of the jam's description. Sits at
            the bottom edge, where the scrim already darkens the art. */}
        <div className="absolute bottom-2 left-2 rounded bg-background/75 px-1.5 py-0.5 backdrop-blur-sm">
          <SignalInline jam={jam} now={now} size="sm" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 px-3 pt-2.5 pb-2.5">
        <Text bold size="lg" className="truncate leading-snug whitespace-nowrap">
          {jam.title}
        </Text>
        <HostLine jam={jam} showHashtag={false} />
        {(dates || duration) && (
          <Text
            variant="muted"
            className={cn("truncate tracking-widest whitespace-nowrap", SUPPORTING_TEXT)}
          >
            {[dates, duration].filter(Boolean).join(" · ")}
          </Text>
        )}
        <div className="mt-auto pt-1.5">
          <MilestoneHeadline jam={jam} now={now} compact />
        </div>
      </div>
      <CardProgressStrip jam={jam} now={now} />
    </motion.button>
  );
}
