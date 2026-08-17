import { FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import {
  type Density,
  JamBannerArt,
  JamBannerBackdrop,
  JamStateBadge,
} from "@/components/home/jam-banner";
import { isBrackeysJam } from "@/components/jams/JamCalendarPage/board/build-board";
import { useJamGradient } from "@/components/jams/JamCalendarPage/board/use-jam-color";
import {
  type JamFromList,
  jamSignal,
  nextMilestone,
} from "@/components/jams/JamCalendarPage/helpers";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { effectiveJamState, formatCountdown } from "@/lib/jam-countdown";
import { jamLinkParams, jamMonthDay } from "@/lib/jam-links";

export interface HeroJam {
  jam: JamFromList;
}

/**
 * Which single jam the hero promotes: Brackeys' own if one is live or
 * upcoming, otherwise the top of the featured tier.
 *
 * Exported separately from the panel because the page needs the answer
 * too — the hero jam is pulled out of the showcase band below so it isn't
 * promoted twice, and an empty featured tier collapses the hero's right
 * column entirely rather than rendering a placeholder panel.
 */
export function pickHeroJam(featured: JamFromList[]): HeroJam | null {
  const brackeys = featured.find(isBrackeysJam);
  if (brackeys) return { jam: brackeys };
  const first = featured[0];
  return first ? { jam: first } : null;
}

const BANNER_HEIGHT: Record<Density, string> = {
  comfortable: "h-52",
  compact: "h-36",
};

export function FeaturedJamPanelSkeleton({ density = "comfortable" }: { density?: Density }) {
  return (
    <Well className="overflow-hidden">
      <Skeleton className={`w-full bg-muted/50 ${BANNER_HEIGHT[density]}`} aria-hidden />
      <div className="flex flex-col gap-3 p-4" aria-hidden>
        <Skeleton className="h-6 w-2/3 bg-muted/50" />
        <Skeleton className="h-3 w-1/3 bg-muted/50" />
        <Skeleton className="h-16 w-full bg-muted/50" />
        <Skeleton className="h-10 w-full bg-muted/50" />
      </div>
    </Well>
  );
}

interface FeaturedJamPanelProps {
  hero: HeroJam;
  now: Date;
  density?: Density;
}

/**
 * The hero's right column: one jam, at full volume.
 *
 * Deliberately *not* the featured carousel. The carousel's job is to let
 * someone browse ten jams; the hero's is to answer "what is happening at
 * Brackeys right now" before the visitor has decided to browse anything.
 * Rotating art under that question is what made the old hero read as
 * decoration.
 */
export function FeaturedJamPanel({ hero, now, density = "comfortable" }: FeaturedJamPanelProps) {
  const { jam } = hero;
  // The jam's own itch theme color shading toward black, same as the
  // board's imageless banners — a palette pick keyed by id gave the hero a
  // colorway the jam doesn't have anywhere else on the site.
  const [bgColor1, bgColor2] = useJamGradient(jam);

  const state = effectiveJamState(jam.startsAt, jam.endsAt, now);
  const milestone = nextMilestone(jam, now);
  const counted = milestone ? formatCountdown(milestone.date, now) : null;
  const signal = jamSignal(jam, now);

  const isCompact = density === "compact";
  const start = jamMonthDay(jam.startsAt);
  const end = jamMonthDay(jam.endsAt);

  return (
    <Well notchOpts className="overflow-hidden">
      <div className={`relative overflow-hidden ${BANNER_HEIGHT[density]}`}>
        <JamBannerBackdrop
          jamId={jam.jamId}
          bannerUrl={jam.bannerUrl}
          bgColor1={bgColor1}
          bgColor2={bgColor2}
        />
        <div className="absolute inset-0">
          <JamBannerArt jam={jam} isCompact={isCompact} />
        </div>
        <div
          className={`pointer-events-none absolute z-20 ${isCompact ? "top-3 left-3" : "top-4 left-4"}`}
        >
          <JamStateBadge state={state} />
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        <div>
          <Heading as="h2" size={isCompact ? "xl" : "2xl"} ellipsis className="leading-tight">
            {jam.title}
          </Heading>
          <MicroLabel as="div" className="mt-1">
            {start.month} {start.day}
            {jam.endsAt ? ` → ${end.month} ${end.day}` : ""}
          </MicroLabel>
        </div>

        {/* One participation number, chosen by the house rule: before a
            jam's deadline `entriesCount` is definitionally ~0, and a hero
            panel reading "ENTRIES 0" undersells the jam it is promoting. */}
        <Well variant="ghost">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 p-3">
            <div className="min-w-0">
              <MicroLabel as="div">{milestone?.label ?? "CLOSED"}</MicroLabel>
              <Text as="div" bold className="text-2xl whitespace-nowrap text-primary">
                {counted?.text ?? "—"}
              </Text>
            </div>
            <div className="border-l border-muted/40 pl-4">
              <MicroLabel as="div">{signal.label}</MicroLabel>
              <Text as="div" bold className="text-2xl">
                <CountUp to={signal.value} duration={0.4} separator="," />
              </Text>
            </div>
          </div>
        </Well>

        {/* Lands on the jam's page here rather than off at itch: the page
            carries the join CTA, the description, and the team-finding
            affordance the home panel can't fit. */}
        <Button
          variant="default"
          size="lg"
          nativeButton={false}
          render={<Link to="/jams/$jamSlug" params={jamLinkParams(jam)} aria-label="Open jam" />}
          className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold tracking-widest"
        >
          <HugeiconsIcon icon={FlashIcon} size={14} />
          OPEN JAM
        </Button>
      </div>
    </Well>
  );
}
