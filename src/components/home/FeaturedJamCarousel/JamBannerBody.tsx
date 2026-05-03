import { FlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "framer-motion";

import { Chonk } from "@/components/ui/chonk";
import { CountUp } from "@/components/ui/count-up";
import { Heading, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { type effectiveJamState, formatJamShortDates } from "@/lib/jam-countdown";

import { CarouselControls, Nub } from "./CarouselControls";
import { BODY_TRANSITION, jamUrl, type JamLike } from "./helpers";
import { JamCountdown } from "./JamCountdown";

type JamState = ReturnType<typeof effectiveJamState>;

interface JamBannerBodyProps {
  jam: JamLike;
  jams: JamLike[];
  state: JamState;
  now: Date;
  index: number;
  paused: boolean;
  isCompact: boolean;
  titleSize: "lg" | "xl";
  statValueClass: string;
  onTogglePause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onGoToNub: (target: number) => void;
}

/**
 * The textual half of a slide: title + dates that cross-fade between
 * jams, the stats well (countdown / joined / entries with count-up
 * animations), the Open Jam CTA, and the pagination nubs + controls.
 */
export function JamBannerBody({
  jam,
  jams,
  state,
  now,
  index,
  paused,
  isCompact,
  titleSize,
  statValueClass,
  onTogglePause,
  onPrev,
  onNext,
  onGoToNub,
}: JamBannerBodyProps) {
  return (
    <div className={`flex flex-col gap-3 ${isCompact ? "p-3" : "p-4"}`}>
      {/* Title + date subtitle: only the textual head cross-fades between slides */}
      <div className="grid grid-cols-1 [&>*]:col-start-1 [&>*]:row-start-1 [&>*]:min-w-0">
        <AnimatePresence initial={false}>
          <motion.div
            key={jam.jamId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={BODY_TRANSITION}
          >
            <Heading as="h3" size={titleSize} monospace ellipsis className="leading-tight">
              {jam.title}
            </Heading>
            <Text as="p" monospace variant="muted" className="text-[11px]">
              {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "Dates TBA"}
              {!isCompact && jam.hosts[0] && ` · Hosts · ${jam.hosts[0].name}`}
            </Text>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Stats: numeric values count up/down rather than fade. CLOSES IN
          flex-grows (so the countdown never wraps), JOINED and ENTRIES
          are auto-sized and sit close together on the right. */}
      <Well variant="ghost">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-3 p-3">
          <div>
            <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
              {state === "upcoming" ? "OPENS IN" : state === "ended" ? "ENDED" : "CLOSES IN"}
            </Text>
            <JamCountdown
              target={state === "upcoming" ? jam.startsAt : jam.endsAt}
              now={now}
              ended={state === "ended"}
              className={`font-mono ${statValueClass} font-bold whitespace-nowrap text-primary`}
            />
          </div>
          <div>
            <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
              JOINED
            </Text>
            <div className={`font-mono ${statValueClass} font-bold`}>
              <CountUp to={jam.joinedCount ?? 0} duration={0.4} separator="," />
            </div>
          </div>
          <div className="border-l border-muted/40 pl-4">
            <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
              ENTRIES
            </Text>
            <div className={`font-mono ${statValueClass} font-bold`}>
              <CountUp to={jam.entriesCount ?? 0} duration={0.4} separator="," />
            </div>
          </div>
        </div>
      </Well>

      {/* Open Jam: static — never fades, just updates href on slide change */}
      <div className="flex flex-wrap gap-2">
        <Chonk
          variant="primary"
          render={
            <a
              href={jamUrl(jam.slug)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open jam"
            />
          }
          className="flex flex-1 items-center justify-center gap-2 px-4 py-2.5 font-mono text-xs font-bold tracking-widest"
        >
          <HugeiconsIcon icon={FlashIcon} size={14} />
          OPEN JAM
        </Chonk>
      </div>

      {/* Nubs + controls */}
      {jams.length > 1 && (
        <div className="flex items-center gap-3 pt-1">
          <div
            className="flex flex-1 items-center gap-1.5"
            role="tablist"
            aria-label="Featured jam"
          >
            {jams.map((j, i) => (
              <Nub
                key={j.jamId}
                active={i === index}
                label={`Show ${j.title}`}
                onClick={() => onGoToNub(i)}
              />
            ))}
          </div>
          <CarouselControls
            paused={paused}
            onPrev={onPrev}
            onNext={onNext}
            onTogglePause={onTogglePause}
          />
        </div>
      )}
    </div>
  );
}
