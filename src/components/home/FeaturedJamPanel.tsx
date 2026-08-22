import { ArrowLeft02Icon, FlashIcon, GridViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { EntryTile, type EntryTileEntry } from "@/components/home/EntryTile";
import type { HeroJam } from "@/components/home/hero-jam";
import {
  BANNER_TRANSITION,
  type Density,
  JamBannerArt,
  JamBannerBackdrop,
  JamCarouselDots,
  JamStateBadge,
} from "@/components/home/jam-banner";
import { useHeroJamEntries } from "@/components/home/use-hero-jam-entries";
import type { RecentEntry } from "@/components/home/use-recent-entries";
import { useJamGradient } from "@/components/jams/JamCalendarPage/board/use-jam-color";
import { jamPhase, jamSignal, nextMilestone } from "@/components/jams/JamCalendarPage/helpers";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { formatCount } from "@/lib/format-count";
import { useReducedMotion } from "@/lib/hooks/use-app-settings";
import { effectiveJamState, formatCountdown } from "@/lib/jam-countdown";
import { jamLinkParams, jamMonthDay } from "@/lib/jam-links";
import { EASE_OUT } from "@/lib/motion";
import { PAGE_CUES } from "@/lib/sound";
import { cn } from "@/lib/utils";

/** Pixels, not a Tailwind class: the banner animates closed, and a height
 * transition needs a number at both ends. */
const BANNER_HEIGHT: Record<Density, number> = {
  comfortable: 208,
  compact: 144,
};

/** The open card is a fixed stage: the container animates to this height
 * while the banner collapses inside it, so content never dictates it. */
const OPEN_HEIGHT: Record<Density, number> = {
  comfortable: 600,
  compact: 500,
};

/** How far past its column the open card grows on each side. Zero on
 * compact — the mobile panel already spans the viewport. */
const OPEN_BLEED: Record<Density, number> = {
  comfortable: 28,
  compact: 0,
};

const MORPH = { duration: 0.3, ease: EASE_OUT };
const CROSSFADE = { duration: 0.15, ease: EASE_OUT };
const INSTANT = { duration: 0 };

/** How long each slide of the hero rotation holds. */
const SLIDE_MS = 7000;

/** `shadow-2xl` at black/40 as a framer target, so the shadow rides the
 * card's tween; the zeroed twin keeps both ends interpolable. */
const CARD_SHADOW = "0 25px 50px -12px rgba(0, 0, 0, 0.4)";
const CARD_SHADOW_NONE = "0 0px 0px 0px rgba(0, 0, 0, 0)";

export function FeaturedJamPanelSkeleton({ density = "comfortable" }: { density?: Density }) {
  return (
    <Well className="overflow-hidden">
      <Skeleton
        className="w-full bg-muted/50"
        style={{ height: BANNER_HEIGHT[density] }}
        aria-hidden
      />
      <div className="flex flex-col gap-3 p-4" aria-hidden>
        <Skeleton className="h-6 w-2/3 bg-muted/50" />
        <Skeleton className="h-3 w-1/3 bg-muted/50" />
        <Skeleton className="h-16 w-full bg-muted/50" />
        <Skeleton className="h-10 w-full bg-muted/50" />
      </div>
    </Well>
  );
}

/** One row of the covers grid: the auto-fill ladder is what lets a third
 * column appear once the open card's bleed gives it room. */
const ENTRY_ROW_CLASSES = "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3";

/** Cover at the ~136px column minimum plus two text lines. An estimate
 * only — mounted rows re-measure themselves. */
const ENTRY_ROW_ESTIMATE = 180;

/** Entries mounted before the probe has resolved a column count — the
 * first client frame. A screenful, not the list. */
const UNMEASURED_ENTRIES = 12;

/** The covers grid, virtualized against the card's own scrollport
 * (`VirtualGrid` hangs off the page scroller, so it can't serve here).
 * Columns come off an empty probe row's template, re-read on resize. */
function EntriesGrid({
  entries,
  scrollport,
  onEndReached,
}: {
  entries: EntryTileEntry[];
  scrollport: HTMLElement | null;
  /** The scroller is nearing the last mounted row — fetch the next page. */
  onEndReached?: () => void;
}) {
  const probeRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(0);

  // Never runs on the server: the entries view only mounts on click.
  useLayoutEffect(() => {
    const probe = probeRef.current;
    if (!probe) return;
    const read = () => {
      if (probe.getBoundingClientRect().width === 0) return;
      const template = getComputedStyle(probe).gridTemplateColumns;
      const next = template && template !== "none" ? template.split(" ").length : 1;
      setColumns((prev) => (prev === next ? prev : next));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  const rowCount = columns > 0 ? Math.ceil(entries.length / columns) : 0;
  const virtualized = scrollport != null && rowCount > 0;

  const virtualizer = useVirtualizer({
    enabled: virtualized,
    count: rowCount,
    getScrollElement: () => scrollport,
    estimateSize: () => ENTRY_ROW_ESTIMATE,
    // Rows are absolutely positioned, so the CSS row gap never applies —
    // the virtualizer adds it to the offsets instead.
    gap: 12,
    overscan: 4,
    getItemKey: (rowIndex) => entries[rowIndex * columns]?.entryId ?? rowIndex,
  });

  // Two rows of runway: ask for more while the last page's tail is still
  // below the fold rather than when the scroller slams into it.
  const lastRow = virtualizer.getVirtualItems().at(-1)?.index ?? -1;
  useEffect(() => {
    if (virtualized && lastRow >= rowCount - 2) onEndReached?.();
  }, [virtualized, lastRow, rowCount, onEndReached]);

  return (
    // The overlay handle floats inside the scrollport's right edge; the
    // padding keeps the last column of covers out from under it.
    <div className="relative pr-3">
      {/* An empty copy of one row, out of flow: its resolved template is
          what says how many tiles share a row. */}
      <div
        ref={probeRef}
        aria-hidden
        className={cn(
          ENTRY_ROW_CLASSES,
          "pointer-events-none invisible absolute inset-x-0 top-0 h-0",
        )}
      />

      {virtualized ? (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const start = row.index * columns;
            return (
              <div
                key={row.key}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className={cn(ENTRY_ROW_CLASSES, "absolute top-0 left-0 w-full")}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                {entries.slice(start, start + columns).map((entry) => (
                  <EntryTile key={entry.entryId} entry={entry} />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={ENTRY_ROW_CLASSES}>
          {entries.slice(0, UNMEASURED_ENTRIES).map((entry) => (
            <EntryTile key={entry.entryId} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FeaturedJamPanelProps {
  /** The hero rotation, priority first. Must be non-empty. */
  heroes: HeroJam[];
  /** Cover samples for every jam in the rotation, keyed by jam id. */
  entriesByJamId: ReadonlyMap<number, RecentEntry[]>;
  now: Date;
  density?: Density;
}

/**
 * The hero's right column: the rotation's jams one at a time, at full
 * volume, with an entries view that flips the card over to a grid of
 * covers. With more than one jam the panel advances itself — paused while
 * the pointer is over it, while the covers are open, and under reduced
 * motion. While open (and through the closing animation) the card floats
 * absolutely over the content below — an outer wrapper holds the closed
 * height so the page never reflows.
 */
export function FeaturedJamPanel({
  heroes,
  entriesByJamId,
  now,
  density = "comfortable",
}: FeaturedJamPanelProps) {
  const [slide, setSlide] = useState(0);
  // Modulo at read time: a pin change can shrink the deck under a live index.
  const hero = heroes[slide % heroes.length]!;
  const { jam } = hero;
  const entries = entriesByJamId.get(jam.jamId) ?? [];

  // The covers belong to the jam they were opened on — a slide change
  // closes them by falling out of this equality, no effect needed.
  const [entriesOpenFor, setEntriesOpenFor] = useState<number | null>(null);
  const showEntries = entriesOpenFor === jam.jamId;
  const gridId = useId();

  const wrapRef = useRef<HTMLDivElement>(null);
  const [closedHeight, setClosedHeight] = useState<number | null>(null);
  const [floating, setFloating] = useState(false);
  const [scrollport, setScrollport] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);

  // A slide change can land on a jam with nothing submitted; that must close
  // the grid rather than hold it open empty.
  const open = showEntries && entries.length > 0;

  // The `entries` prop is the landing page's ten-cover sample; the open
  // grid pulls the jam's full feed — most-rated first while voting is on,
  // newest otherwise — showing the sample until the first page lands.
  const phase = jamPhase(jam, now);
  const sortBy = phase === "voting" && (jam.ratingsCount ?? 0) > 0 ? "ratings" : "recent";
  const fullEntries = useHeroJamEntries(jam.jamId, open, sortBy);
  const gridEntries = fullEntries.entries.length > 0 ? fullEntries.entries : entries;
  const entryCount = Math.max(jam.entriesCount ?? 0, entries.length);

  const reduced = useReducedMotion();
  const morph = reduced ? INSTANT : MORPH;
  const crossfade = reduced ? INSTANT : CROSSFADE;

  const rotating = heroes.length > 1 && !reduced && !hovered && !showEntries && !floating;
  useEffect(() => {
    if (!rotating) return;
    const timer = setInterval(() => setSlide((i) => (i + 1) % heroes.length), SLIDE_MS);
    return () => clearInterval(timer);
  }, [rotating, heroes.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setEntriesOpenFor(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const toggleEntries = () => {
    if (!open) {
      setClosedHeight(wrapRef.current?.offsetHeight ?? null);
      setFloating(true);
    }
    setEntriesOpenFor((prev) => (prev === jam.jamId ? null : jam.jamId));
  };

  const [bgColor1, bgColor2] = useJamGradient(jam);

  const state = effectiveJamState(jam.startsAt, jam.endsAt, now);
  const milestone = nextMilestone(jam, now);
  const counted = milestone ? formatCountdown(milestone.date, now) : null;
  const signal = jamSignal(jam, now);

  const isCompact = density === "compact";
  const start = jamMonthDay(jam.startsAt);
  const end = jamMonthDay(jam.endsAt);

  // Heights tween number-to-number (`auto` doesn't interpolate), so
  // opening keyframes from the measured closed height. Memoized so the
  // ticking clock's re-renders never restart a running animation.
  const cardAnimate = useMemo(() => {
    if (!floating || !closedHeight)
      return { height: "auto", marginLeft: 0, marginRight: 0, boxShadow: CARD_SHADOW_NONE };
    if (!open)
      return { height: closedHeight, marginLeft: 0, marginRight: 0, boxShadow: CARD_SHADOW_NONE };
    const bleed = OPEN_BLEED[density];
    return {
      // Open target always clears the closed height, so the two ends of
      // the transition can never collide.
      height: [closedHeight, Math.max(OPEN_HEIGHT[density], closedHeight + 96)],
      marginLeft: -bleed,
      marginRight: -bleed,
      boxShadow: CARD_SHADOW,
    };
  }, [floating, closedHeight, open, density]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      style={floating && closedHeight ? { height: closedHeight } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <motion.div
        className={cn(floating && "absolute inset-x-0 top-0 z-30 rounded-lg")}
        initial={false}
        animate={cardAnimate}
        transition={morph}
        onAnimationComplete={(definition) => {
          // Rejoin the page flow only once the card has shrunk back down.
          if ((definition as { height?: number | string }).height === closedHeight) {
            setFloating(false);
          }
        }}
      >
        <Well notchOpts className="flex h-full flex-col overflow-hidden">
          <motion.div
            className="relative shrink-0 overflow-hidden"
            initial={false}
            animate={{ height: open ? 0 : BANNER_HEIGHT[density] }}
            transition={morph}
          >
            <JamBannerBackdrop
              jamId={jam.jamId}
              bannerUrl={jam.bannerUrl}
              bgColor1={bgColor1}
              bgColor2={bgColor2}
            />
            {/* popLayout: `wait` would leave the backdrop bare between slides. */}
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={jam.jamId}
                initial={reduced ? { opacity: 0 } : { opacity: 0, x: 32 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: -32 }}
                transition={reduced ? INSTANT : BANNER_TRANSITION}
                className="absolute inset-0"
              >
                <JamBannerArt jam={jam} isCompact={isCompact} />
              </motion.div>
            </AnimatePresence>
            <div
              className={`pointer-events-none absolute z-20 ${isCompact ? "top-3 left-3" : "top-4 left-4"}`}
            >
              <JamStateBadge state={state} />
            </div>
            {heroes.length > 1 && (
              <JamCarouselDots
                slides={heroes.map((h) => h.jam)}
                active={slide % heroes.length}
                onSelect={setSlide}
                className={`absolute z-20 ${isCompact ? "bottom-3 left-3" : "bottom-4 left-4"}`}
              />
            )}
          </motion.div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={jam.jamId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={crossfade}
              >
                <Heading as="h2" size={isCompact ? "xl" : "2xl"} ellipsis className="leading-tight">
                  {jam.title}
                </Heading>
                <MicroLabel as="div" className="mt-1">
                  {start.month} {start.day}
                  {jam.endsAt ? ` → ${end.month} ${end.day}` : ""}
                </MicroLabel>
              </motion.div>
            </AnimatePresence>

            {/* popLayout: `wait` would collapse the card to its title between
              the crossfading halves. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {open ? (
                <motion.div
                  key="entries"
                  id={gridId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={crossfade}
                  className="min-h-0 flex-1"
                >
                  <OverlayScrollbarsComponent
                    element="div"
                    className="h-full"
                    options={{
                      scrollbars: {
                        // Dual-class as in `JamDetailModal`: dark is the
                        // structural base, accent tints the handle.
                        theme: "os-theme-dark os-theme-accent",
                        autoHide: "scroll",
                        autoHideDelay: 600,
                      },
                    }}
                    events={{
                      // The virtualizer scrolls the plugin's viewport, not
                      // the component's root element.
                      initialized: (instance) => setScrollport(instance.elements().viewport),
                      destroyed: () => setScrollport(null),
                    }}
                  >
                    <EntriesGrid
                      entries={gridEntries}
                      scrollport={scrollport}
                      onEndReached={fullEntries.fetchMore}
                    />
                  </OverlayScrollbarsComponent>
                </motion.div>
              ) : (
                <motion.div
                  key="stats"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={crossfade}
                >
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
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-auto flex gap-2">
              {/* `layout` lets OPEN JAM glide as its neighbour comes and
                  goes with the rotation, instead of snapping wide. */}
              <motion.div layout className="min-w-0 flex-1" transition={morph}>
                <Button
                  variant="default"
                  size="lg"
                  nativeButton={false}
                  render={
                    <Link to="/jams/$jamSlug" params={jamLinkParams(jam)} aria-label="Open jam" />
                  }
                  className="flex w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold tracking-widest"
                >
                  <HugeiconsIcon icon={FlashIcon} size={14} />
                  OPEN JAM
                </Button>
              </motion.div>

              <AnimatePresence initial={false} mode="popLayout">
                {entries.length > 0 && (
                  <motion.div
                    key="entries-button"
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={crossfade}
                  >
                    <Button
                      variant="outline"
                      size="lg"
                      aria-expanded={open}
                      aria-controls={open ? gridId : undefined}
                      onClick={toggleEntries}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold tracking-widest text-muted-foreground hover:text-primary"
                      {...PAGE_CUES}
                    >
                      <HugeiconsIcon icon={open ? ArrowLeft02Icon : GridViewIcon} size={14} />
                      {open ? "BACK" : `ENTRIES ${formatCount(entryCount)}`}
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </Well>
      </motion.div>
    </div>
  );
}
