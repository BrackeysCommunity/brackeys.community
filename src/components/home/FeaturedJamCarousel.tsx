import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Calendar03Icon,
  FlashIcon,
  PauseIcon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { Chonk } from "@/components/ui/chonk";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Well } from "@/components/ui/well";
import useDateNow from "@/lib/hooks/use-date-now";
import { effectiveJamState, formatCountdown, formatJamShortDates } from "@/lib/jam-countdown";
import { cn } from "@/lib/utils";

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
const BODY_TRANSITION = { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const };
const BANNER_TRANSITION = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };

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
  const lastIndexRef = useRef(0);

  // Reset to start whenever the underlying list changes shape.
  useEffect(() => {
    setIndex((i) => (i >= jams.length ? 0 : i));
  }, [jams.length]);

  useEffect(() => {
    if (paused || jams.length <= 1) return;
    const id = window.setInterval(() => {
      setDirection(1);
      setIndex((i) => (i + 1) % jams.length);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused, jams.length]);

  const goTo = (next: number) => {
    if (jams.length <= 1) return;
    const normalized = ((next % jams.length) + jams.length) % jams.length;
    setDirection(
      normalized === lastIndexRef.current ? 1 : normalized > lastIndexRef.current ? 1 : -1,
    );
    lastIndexRef.current = normalized;
    setIndex(normalized);
  };

  const goPrev = () => goTo(index - 1);
  const goNext = () => goTo(index + 1);

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
        <div className="p-6 text-center font-mono text-xs tracking-widest text-muted-foreground uppercase">
          No active jams right now
        </div>
      </Well>
    );
  }

  const state = effectiveJamState(jam.startsAt, jam.endsAt, nowDate);
  const isCompact = density === "compact";
  const bannerHeight = isCompact ? "h-32" : "h-40";
  const titleClass = isCompact ? "text-lg" : "text-xl";
  const statValueClass = isCompact ? "text-xl" : "text-2xl";

  return (
    <Well>
      {/* Banner — slides horizontally on slide change */}
      <div
        className={`relative ${bannerHeight} overflow-hidden`}
        style={{ background: "color-mix(in srgb, var(--color-foreground) 4%, transparent)" }}
      >
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={jam.jamId}
            custom={direction}
            initial={{ x: SLIDE_DISTANCE * direction, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -SLIDE_DISTANCE * direction, opacity: 0 }}
            transition={BANNER_TRANSITION}
            className={`absolute inset-0 flex items-end justify-end ${isCompact ? "p-3" : "p-4"}`}
            style={{
              backgroundImage: jam.bannerUrl
                ? `url(${jam.bannerUrl})`
                : "repeating-linear-gradient(135deg, color-mix(in srgb, var(--color-foreground) 4%, transparent) 0 8px, transparent 8px 16px)",
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            <div
              className={`absolute ${isCompact ? "top-3 left-3" : "top-4 left-4"} flex items-center gap-2 font-mono text-[10px] font-bold tracking-widest uppercase`}
            >
              {state === "running" ? (
                <span className="flex items-center gap-1.5 bg-destructive px-1.5 py-0.5 text-destructive-foreground">
                  <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inset-0 animate-ping rounded-full bg-destructive-foreground opacity-75" />
                    <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-destructive-foreground" />
                  </span>
                  // LIVE
                </span>
              ) : (
                <span className="bg-muted px-1.5 py-0.5 text-foreground">
                  // {state.toUpperCase()}
                </span>
              )}
              {jam.hosts[0] && (
                <span className="text-muted-foreground">{jam.hosts[0].name.toUpperCase()}</span>
              )}
            </div>
            <span
              className={`font-mono ${isCompact ? "text-3xl" : "text-5xl"} leading-none font-bold tracking-tighter text-foreground/40`}
            >
              {shortName(jam.title)}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Body — cross-fades between slides */}
      <div className={`flex flex-col gap-3 ${isCompact ? "p-3" : "p-4"}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={jam.jamId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={BODY_TRANSITION}
            className="flex flex-col gap-3"
          >
            <div>
              <h3 className={`font-mono ${titleClass} leading-tight font-bold`}>{jam.title}</h3>
              <p className="font-mono text-[11px] text-muted-foreground">
                {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "Dates TBA"}
                {!isCompact && jam.hosts[0] && ` · Hosts · ${jam.hosts[0].name}`}
              </p>
            </div>

            <Well variant="ghost">
              <div className={cn("grid gap-3 p-3", isCompact ? "grid-cols-3" : "grid-cols-3")}>
                <div>
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    {state === "upcoming" ? "OPENS IN" : state === "ended" ? "ENDED" : "CLOSES IN"}
                  </div>
                  <div className={`font-mono ${statValueClass} font-bold text-primary`}>
                    {state === "ended"
                      ? "—"
                      : (formatCountdown(state === "upcoming" ? jam.startsAt : jam.endsAt, nowDate)
                          ?.text ?? "—")}
                  </div>
                </div>
                <div>
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    JOINED
                  </div>
                  <div className={`font-mono ${statValueClass} font-bold`}>
                    {jam.joinedCount?.toLocaleString("en-US") ?? "—"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] tracking-widest text-muted-foreground">
                    ENTRIES
                  </div>
                  <div className={`font-mono ${statValueClass} font-bold`}>
                    {jam.entriesCount?.toLocaleString("en-US") ?? "—"}
                  </div>
                </div>
              </div>
            </Well>

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
              {!isCompact && (
                <Chonk
                  variant="surface"
                  render={
                    <a
                      href="https://itch.io/jams"
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="All jams"
                    />
                  }
                  className="flex items-center gap-2 px-4 py-2.5 font-mono text-xs font-bold tracking-widest text-muted-foreground"
                >
                  <HugeiconsIcon icon={Calendar03Icon} size={14} />
                  ALL JAMS
                </Chonk>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

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
                  onClick={() => goTo(i)}
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
        onMouseDown={(e) => e.preventDefault()}
        onClick={onNext}
        icon={<HugeiconsIcon icon={ArrowRight01Icon} size={12} />}
      />
    </SegmentedControl>
  );
}
