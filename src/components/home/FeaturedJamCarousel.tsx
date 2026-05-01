import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  FlashIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Chonk } from "@/components/ui/chonk";
import { CountUp } from "@/components/ui/count-up";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Heading, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { effectiveJamState, formatJamShortDates } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";

const STRIPE_BG =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-foreground) 4%, transparent) 0 8px, transparent 8px 16px)";
const IMAGE_MASK = "linear-gradient(to right, transparent 0%, black 15%)";

function countdownParts(target: Date | string | null | undefined, now: Date) {
  if (!target) return null;
  const t = typeof target === "string" ? new Date(target) : target;
  const ms = t.getTime() - now.getTime();
  if (Number.isNaN(ms)) return null;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor(abs / 3_600_000) % 24;
  const m = Math.floor(abs / 60_000) % 60;
  return { d, h, m };
}

const ROTATE_MS = 6000;

interface JamLike {
  jamId: number;
  slug: string;
  title: string;
  bannerUrl: string | null;
  hosts: { name: string; url: string }[];
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  entriesCount: number | null;
  joinedCount: number | null;
}

function shortName(title: string) {
  const initials = title
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return initials.slice(0, 6) || title.slice(0, 5).toUpperCase();
}

function jamUrl(slug: string) {
  return `https://itch.io/jam/${slug}`;
}

export interface FeaturedJamCarouselProps {
  jams: JamLike[];
  isLoading?: boolean;
  density?: "compact" | "comfortable";
}

const SLIDE_DISTANCE = 60; // px
const BODY_TRANSITION = { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const };
const BANNER_TRANSITION = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };

// Swipe-to-navigate thresholds. Either a long-enough drag OR a fast-enough
// flick triggers a slide change.
const SWIPE_OFFSET = 50; // px of drag distance
const SWIPE_VELOCITY = 500; // px/s flick speed

// Variants are functions of `custom` (the slide direction). AnimatePresence
// forwards its `custom` to exiting children even after they've been removed
// from React's rendered children — so when the user reverses direction
// mid-flight, the outgoing slide reads the *latest* direction and exits in
// the same direction the new slide is entering.
const slideVariants = {
  enter: (dir: 1 | -1) => ({ x: SLIDE_DISTANCE * dir, opacity: 0, scale: 1.15 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: 1 | -1) => ({ x: -SLIDE_DISTANCE * dir, opacity: 0, scale: 1.15 }),
};

/**
 * Auto-rotating carousel of live jams. The banner image slides horizontally
 * between slides; the textual body cross-fades. Pagination "nubs" morph in
 * width rather than fading. A right-anchored control segment offers prev /
 * pause / next; pause is the only toggle, prev and next are momentary.
 */
export function FeaturedJamCarousel({
  jams,
  isLoading,
  density = "comfortable",
}: FeaturedJamCarouselProps) {
  const now = useDateNow();
  const nowDate = new Date(now);

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [paused, setPaused] = useState(false);

  // Reset to start whenever the underlying list changes shape.
  useEffect(() => {
    setIndex((i) => (i >= jams.length ? 0 : i));
  }, [jams.length]);

  // Auto-rotate. `index` is in deps so any manual navigation (which calls
  // setIndex) restarts the timer — otherwise an auto-advance can fire moments
  // after a tap.
  useEffect(() => {
    if (paused || jams.length <= 1) return;
    const id = window.setInterval(() => {
      setDirection(1);
      setIndex((i) => (i + 1) % jams.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, jams.length, index]);

  const goTo = (next: number, dir: 1 | -1) => {
    if (jams.length <= 1) return;
    const normalized = ((next % jams.length) + jams.length) % jams.length;
    if (normalized === index) return;
    setDirection(dir);
    setIndex(normalized);
  };

  const goPrev = () => goTo(index - 1, -1);
  const goNext = () => goTo(index + 1, 1);
  const goToNub = (target: number) => goTo(target, target >= index ? 1 : -1);

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
      {/* Banner. Stripe pattern is painted on the static outer container with
          `background-attachment: fixed`, so as the page scrolls the stripes
          stay anchored to the viewport — the carousel reveals different
          stripes as it moves, producing a subtle parallax. The drag layer
          inside translates the image+content on swipe; the stripes stay put
          because they live on the non-translating parent. */}
      <div
        className={`relative ${bannerHeight} overflow-hidden`}
        style={{ backgroundImage: STRIPE_BG, backgroundAttachment: "fixed" }}
      >
        {/* Re-paint the Well's debossed top edge above the banner image so
            the deboss isn't obscured by full-bleed banners. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px]"
          style={{ background: "var(--deboss-shadow)" }}
        />
        {/* Swipe layer: dragging left advances, right rewinds. Snaps back
            with dragElastic if the threshold isn't crossed. */}
        <motion.div
          className="absolute inset-0"
          style={{ touchAction: "pan-y" }}
          drag={jams.length > 1 ? "x" : false}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.2}
          onDragEnd={(_, info) => {
            const { offset, velocity } = info;
            if (offset.x < -SWIPE_OFFSET || velocity.x < -SWIPE_VELOCITY) goNext();
            else if (offset.x > SWIPE_OFFSET || velocity.x > SWIPE_VELOCITY) goPrev();
          }}
        >
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={jam.jamId}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={BANNER_TRANSITION}
              className="absolute inset-0"
            >
              {jam.bannerUrl && (
                <img
                  src={jam.bannerUrl}
                  alt=""
                  aria-hidden
                  className="absolute top-0 right-0 block h-full w-auto max-w-full object-cover object-right"
                  style={{ maskImage: IMAGE_MASK, WebkitMaskImage: IMAGE_MASK }}
                />
              )}

              <div
                className={`absolute ${isCompact ? "top-3 left-3" : "top-4 left-4"} z-10 flex flex-col items-start gap-1`}
              >
                {state === "running" ? (
                  <Badge variant="destructive" className="gap-1.5">
                    <span className="relative inline-flex h-1.5 w-1.5">
                      <span className="absolute inset-0 animate-ping rounded-full bg-destructive-foreground opacity-75" />
                      <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
                    </span>
                    LIVE
                  </Badge>
                ) : (
                  <Badge variant="secondary">{state.toUpperCase()}</Badge>
                )}
                {jam.hosts[0] && (
                  <Text
                    monospace
                    bold
                    size="xs"
                    variant="muted"
                    className="tracking-widest uppercase"
                  >
                    {jam.hosts[0].name}
                  </Text>
                )}
              </div>

              {!jam.bannerUrl && (
                <Text
                  monospace
                  bold
                  density="dense"
                  className={`absolute right-3 bottom-3 ${isCompact ? "text-3xl" : "text-5xl"} z-10 tracking-tighter text-foreground/40`}
                >
                  {shortName(jam.title)}
                </Text>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Body */}
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

        {/* Stats: numeric values count up/down rather than fade. Layout:
            CLOSES IN flex-grows (so the countdown never wraps), JOINED and
            ENTRIES are auto-sized and sit close together on the right. */}
        <Well variant="ghost">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-3 p-3">
            <div>
              <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
                {state === "upcoming" ? "OPENS IN" : state === "ended" ? "ENDED" : "CLOSES IN"}
              </Text>
              <CountdownValue
                target={state === "upcoming" ? jam.startsAt : jam.endsAt}
                now={nowDate}
                ended={state === "ended"}
                className={`font-mono ${statValueClass} font-bold whitespace-nowrap text-primary`}
              />
            </div>
            <div>
              <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
                JOINED
              </Text>
              <div className={`font-mono ${statValueClass} font-bold`}>
                <CountUp to={jam.joinedCount ?? 0} duration={0.5} separator="," />
              </div>
            </div>
            <div className="border-l border-muted/40 pl-4">
              <Text as="div" monospace size="xs" variant="muted" className="tracking-widest">
                ENTRIES
              </Text>
              <div className={`font-mono ${statValueClass} font-bold`}>
                <CountUp to={jam.entriesCount ?? 0} duration={0.5} separator="," />
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
                  onClick={() => goToNub(i)}
                />
              ))}
            </div>
            <CarouselControls
              paused={paused}
              onPrev={goPrev}
              onNext={goNext}
              onTogglePause={() => setPaused((p) => !p)}
            />
          </div>
        )}
      </div>
    </Well>
  );
}

function CountdownValue({
  target,
  now,
  ended,
  className,
}: {
  target: Date | string | null;
  now: Date;
  ended: boolean;
  className?: string;
}) {
  if (ended) return <div className={className}>—</div>;
  const parts = countdownParts(target, now);
  if (!parts) return <div className={className}>—</div>;
  return (
    <div className={className}>
      {parts.d > 0 ? (
        <>
          <CountUp to={parts.d} duration={0.5} />
          <span>d </span>
          <CountUp to={parts.h} duration={0.5} />
          <span>h</span>
        </>
      ) : parts.h > 0 ? (
        <>
          <CountUp to={parts.h} duration={0.5} />
          <span>h </span>
          <CountUp to={parts.m} duration={0.5} />
          <span>m</span>
        </>
      ) : (
        <>
          <CountUp to={parts.m} duration={0.5} />
          <span>m</span>
        </>
      )}
    </div>
  );
}

function Nub({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      // Don't take focus on click — keeps the carousel container from
      // receiving a focus-within outline as we tap through nubs.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="group flex h-3 items-center"
    >
      <motion.span
        animate={{ width: active ? 18 : 6 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        className={cn(
          "block h-1.5",
          active ? "bg-primary" : "bg-muted-foreground/40 group-hover:bg-muted-foreground",
        )}
      />
    </button>
  );
}

interface ControlsProps {
  paused: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
}

/**
 * Right-anchored prev / pause / next segment built on `SegmentedControl`.
 * Prev and next fire on click but never become the selected value; pause is
 * the only keepable selection (toggling it sets the segmented value to
 * "pause" or back to "" so the pressed state reflects autoplay state).
 */
function CarouselControls({ paused, onPrev, onNext, onTogglePause }: ControlsProps) {
  return (
    <SegmentedControl
      size="xs"
      priority="default"
      value={paused ? "pause" : ""}
      // Selection is owned by `paused`; SegmentedControl's onChange fires for
      // every item click but we route the actual side-effects through each
      // item's onClick (which still fires when the wrapper suppresses the
      // change, e.g. clicking the same pause to toggle it off).
      onChange={() => {}}
      aria-label="Carousel controls"
    >
      <SegmentedControl.Item
        value="prev"
        aria-label="Previous jam"
        className="rounded-l-sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPrev}
        icon={<HugeiconsIcon icon={ArrowLeft01Icon} size={12} />}
      />
      <SegmentedControl.Item
        value="pause"
        aria-label={paused ? "Resume autoplay" : "Pause autoplay"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onTogglePause}
        icon={<HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} size={12} />}
      />
      <SegmentedControl.Item
        value="next"
        aria-label="Next jam"
        className="rounded-r-sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNext}
        icon={<HugeiconsIcon icon={ArrowRight01Icon} size={12} />}
      />
    </SegmentedControl>
  );
}
