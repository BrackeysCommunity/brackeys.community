import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { effectiveJamState } from "@/lib/jam-countdown";

import { type Density, type JamLike } from "./helpers";
import { JamBanner } from "./JamBanner";
import { JamBannerBody } from "./JamBannerBody";
import { useCarousel } from "./use-carousel";
import { useGrainientPalette } from "./use-grainient-palette";

export interface FeaturedJamCarouselProps {
  jams: JamLike[];
  isLoading?: boolean;
  density?: Density;
}

/**
 * Auto-rotating carousel of live jams. Composition only — slide state
 * comes from `useCarousel`, the random-color backdrop from
 * `useGrainientPalette`, and the visual halves from `JamBanner` and
 * `JamBannerBody`.
 */
export function FeaturedJamCarousel({
  jams,
  isLoading,
  density = "comfortable",
}: FeaturedJamCarouselProps) {
  const now = useDateNow();
  const nowDate = new Date(now);

  const { index, direction, paused, goPrev, goNext, goToNub, togglePause } = useCarousel(
    jams.length,
  );
  const [bgColor1, bgColor2] = useGrainientPalette(jams, index);

  if (isLoading) {
    return (
      <Well>
        <div
          className={density === "compact" ? "h-64 animate-pulse" : "h-72 animate-pulse"}
          aria-hidden
        />
      </Well>
    );
  }

  const jam = jams[index];
  if (!jam) {
    return (
      <Well>
        <Text
          as="div"
          monospace
          size="sm"
          variant="muted"
          align="center"
          className="p-6 tracking-widest uppercase"
        >
          No active jams right now
        </Text>
      </Well>
    );
  }

  const state = effectiveJamState(jam.startsAt, jam.endsAt, nowDate);
  const isCompact = density === "compact";
  const bannerHeight = isCompact ? "h-32" : "h-40";
  const titleSize = isCompact ? "lg" : "xl";
  const statValueClass = isCompact ? "text-xl" : "text-2xl";

  return (
    <Well className="overflow-hidden">
      <JamBanner
        jam={jam}
        jamCount={jams.length}
        state={state}
        isCompact={isCompact}
        height={bannerHeight}
        bgColor1={bgColor1}
        bgColor2={bgColor2}
        direction={direction}
        onPrev={goPrev}
        onNext={goNext}
      />
      <JamBannerBody
        jam={jam}
        jams={jams}
        state={state}
        now={nowDate}
        index={index}
        paused={paused}
        isCompact={isCompact}
        titleSize={titleSize}
        statValueClass={statValueClass}
        onTogglePause={togglePause}
        onPrev={goPrev}
        onNext={goNext}
        onGoToNub={goToNub}
      />
    </Well>
  );
}
