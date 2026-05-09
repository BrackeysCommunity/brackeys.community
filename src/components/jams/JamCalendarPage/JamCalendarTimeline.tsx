import { useVirtualizer } from "@tanstack/react-virtual";
import { LayoutGroup, motion } from "framer-motion";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { Grainient } from "@/components/ui/grainient";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, InlineCode, Text } from "@/components/ui/typography";
import { useThemeChartColors } from "@/lib/hooks/use-theme-chart-colors";
import { durationDays, formatJamShortDates } from "@/lib/jam-countdown";

import {
  type ChipKind,
  type JamFromList,
  jamPaletteColors,
  jamPhase,
  monthKey,
  monthLabel,
} from "./helpers";
import { JamDetailModal } from "./JamDetailModal";
import type { TimelineRange } from "./shared-types";

// When the modal closes, the row is the *target* of the shared-layout
// animation — framer animates the modal's layoutId from its big
// modal-rectangle back to this row's bounds, and uses the transition
// declared on the *destination* element. We want close to feel snappy
// with a small overshoot, so the row gets a stiffer, bouncier spring
// than the modal's leisurely open transition.
const ROW_CLOSE_TRANSITION = {
  type: "spring" as const,
  stiffness: 520,
  damping: 32,
  mass: 0.7,
};

interface JamCalendarTimelineProps {
  jams: JamFromList[];
  now: Date;
  isLoading: boolean;
  range: TimelineRange;
  visibleChips: Record<ChipKind, boolean>;
}

interface TimelineEvent {
  jam: JamFromList;
  kind: ChipKind;
  date: Date;
}

type TimelineItem =
  | { type: "header"; key: string; month: string; year: string; count: number }
  | { type: "event"; key: string; event: TimelineEvent };

const KIND_META: Record<
  ChipKind,
  {
    glyph: string;
    label: string;
    codeVariant: "primary" | "warning" | "destructive" | "neutral";
  }
> = {
  starting: { glyph: "▶", label: "start", codeVariant: "primary" },
  deadline: { glyph: "⊙", label: "deadline", codeVariant: "warning" },
  ending: { glyph: "■", label: "voting ends", codeVariant: "destructive" },
};

/**
 * Vertical timeline of jam *events* — one row per
 * start / submission deadline / voting end. The ▶ ⊙ ■ legend chips at
 * the top mirror the calendar's per-day badges so readers can map
 * between the two surfaces. UPCOMING filters to events from today
 * forward; ALL also surfaces events whose date is already in the past.
 */
export function JamCalendarTimeline({
  jams,
  now,
  isLoading,
  range,
  visibleChips,
}: JamCalendarTimelineProps) {
  // Expand jams into events: each jam contributes up to three rows
  // (start, submission deadline, voting end). Rows are independent and
  // sorted/grouped by their event date.
  const events = useMemo(() => expandToEvents(jams), [jams]);

  const filtered = useMemo(() => {
    const cutoff = now.getTime();
    return events.filter((e) => {
      if (!visibleChips[e.kind]) return false;
      if (range === "upcoming" && e.date.getTime() < cutoff) return false;
      return true;
    });
  }, [events, range, now, visibleChips]);

  const groups = useMemo(() => groupByEventMonth(filtered), [filtered]);

  // Flatten the grouped events into a single list of virtual rows so we
  // can virtualize the whole thing with one window virtualizer instead
  // of mounting a row (and its WebGL Grainient) per jam upfront.
  const items = useMemo<TimelineItem[]>(() => {
    const out: TimelineItem[] = [];
    for (const g of groups) {
      const { month, year } = monthLabel(g.key);
      out.push({ type: "header", key: g.key, month, year, count: g.entries.length });
      for (const e of g.entries) {
        out.push({ type: "event", key: `${e.jam.jamId}-${e.kind}`, event: e });
      }
    }
    return out;
  }, [groups]);

  // The page content scrolls inside an ancestor `overflow-y: auto`
  // container (set up in __root.tsx), not the window — so we hand the
  // virtualizer the nearest scrolling ancestor and offset list items by
  // its offsetTop within that scroller.
  const parentRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const sc = findScrollParent(el);
    setScroller(sc);
    let top = 0;
    let cur: HTMLElement | null = el;
    while (cur && cur !== sc) {
      top += cur.offsetTop;
      cur = cur.offsetParent as HTMLElement | null;
    }
    setScrollMargin(top);
  }, [items.length]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: (i) => (items[i]?.type === "header" ? 80 : 116),
    // Mount a generous buffer of rows beyond the viewport so a fast
    // scroll lands on already-painted content instead of empty space
    // while the virtualizer catches up. Each row is cheap (one of the
    // images / Grainients) and the WebGL contexts are explicitly freed
    // on unmount, so a deeper overscan doesn't pile up state.
    overscan: 16,
    getItemKey: (i) => items[i]!.key,
    scrollMargin,
  });

  // Selected event drives the spotlight modal. We track the row's
  // composite key as `layoutKey` so the modal's `layoutId` matches the
  // exact row that launched it (a jam can appear in multiple rows —
  // start / deadline / voting end).
  const [selected, setSelected] = useState<{ jam: JamFromList; layoutKey: string } | null>(null);

  return (
    <div className="flex flex-col">
      {isLoading ? (
        <TimelineSkeleton />
      ) : groups.length === 0 ? (
        <Text
          as="div"
          monospace
          size="sm"
          variant="muted"
          align="center"
          className="p-12 tracking-widest uppercase"
        >
          {range === "upcoming"
            ? "Nothing upcoming — try ALL to see past events"
            : "No events match those filters"}
        </Text>
      ) : (
        <LayoutGroup>
          <div
            ref={parentRef}
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const item = items[vItem.index]!;
              return (
                <div
                  key={vItem.key}
                  ref={virtualizer.measureElement}
                  data-index={vItem.index}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    transform: `translateY(${vItem.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  {item.type === "header" ? (
                    <MonthHeader month={item.month} year={item.year} count={item.count} />
                  ) : (
                    <div className="border-b border-muted/20">
                      <TimelineRow
                        event={item.event}
                        now={now}
                        layoutKey={item.key}
                        isSelected={selected?.layoutKey === item.key}
                        onSelect={(jam) => setSelected({ jam, layoutKey: item.key })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <JamDetailModal
            jam={selected?.jam ?? null}
            layoutKey={selected?.layoutKey ?? null}
            onClose={() => setSelected(null)}
          />
        </LayoutGroup>
      )}
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex items-end justify-between gap-3 border-b border-muted/30 pt-6 pb-2">
        <div className="flex items-baseline gap-2">
          <Skeleton className="h-7 w-32 rounded" />
          <Skeleton className="h-4 w-12 rounded" />
        </div>
        <Skeleton className="h-3 w-16 rounded" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-muted/20 px-3 py-3 sm:grid-cols-[8rem_minmax(0,1fr)_auto]"
        >
          <Skeleton className="h-20 w-full rounded" />
          <div className="flex min-w-0 flex-col gap-2">
            <Skeleton className="h-5 w-24 rounded" />
            <Skeleton className="h-5 w-3/5 rounded" />
            <Skeleton className="h-3 w-2/5 rounded" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <Skeleton className="h-3 w-12 rounded" />
            <Skeleton className="h-5 w-8 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MonthHeader({ month, year, count }: { month: string; year: string; count: number }) {
  return (
    <header className="flex items-end justify-between gap-3 border-b border-muted/30 pt-6 pb-2">
      <div className="flex items-baseline gap-2">
        <Heading as="h2" monospace className="text-3xl tracking-tight">
          {month}
        </Heading>
        <Text monospace size="md" variant="muted" className="tracking-widest">
          {year}
        </Text>
      </div>
      <Text monospace size="xs" variant="muted" className="tracking-widest tabular-nums">
        {count} EVENT{count === 1 ? "" : "S"}
      </Text>
    </header>
  );
}

function TimelineRow({
  event,
  now,
  layoutKey,
  isSelected,
  onSelect,
}: {
  event: TimelineEvent;
  now: Date;
  /** Stable id used both as `layoutId` for the row and to address the
   * matching motion.div in the spotlight modal. */
  layoutKey: string;
  /** Hide the row's painted contents while its modal is open — without
   * this, framer renders the row at the modal's destination size and
   * position simultaneously, fighting the layout animation. */
  isSelected: boolean;
  onSelect: (jam: JamFromList) => void;
}) {
  const { jam, kind, date } = event;
  // Once a jam's voting window has closed the row's "kind" (starting /
  // deadline / ending) is just trivia — collapse them all to a neutral
  // ARCHIVED badge so the timeline doesn't claim a long-past event is
  // currently happening.
  const isArchived = jamPhase(jam, now) === "archive";
  // Some jams skip the voting window — they just end on `endsAt` and
  // there is no separate `votingEndsAt`. In that case the "deadline"
  // event is really the jam's full close, so swap the label/glyph to
  // match. Jams with voting keep the "deadline → voting ends" pair.
  const baseMeta = KIND_META[kind];
  const isFullEnd = kind === "deadline" && !jam.votingEndsAt;
  const meta = isArchived
    ? ({ glyph: "▣", label: "archived", codeVariant: "neutral" } as const)
    : isFullEnd
      ? ({ glyph: "■", label: "ends", codeVariant: "destructive" } as const)
      : baseMeta;
  const cohosts = jam.hosts.slice(1);
  const monthShort = date
    .toLocaleString(undefined, { month: "short", timeZone: "UTC" })
    .toUpperCase();
  const [bgOk, setBgOk] = useState(true);

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(jam)}
      layoutId={`tl-row-${layoutKey}`}
      // Suppress framer's layout animation on routine re-renders — it
      // should only animate during the open/close handoff with the
      // modal, never on incidental layout shifts (virtualizer mounts,
      // window resize). The `tl-row-*` layoutId is enough to match the
      // modal; we don't need continuous tracking here.
      layout={false}
      transition={ROW_CLOSE_TRANSITION}
      style={{ opacity: isSelected ? 0 : 1 }}
      className="group relative block w-full cursor-pointer overflow-hidden text-left transition-colors"
    >
      {jam.bannerUrl && bgOk ? (
        <>
          <img
            src={jam.bannerUrl}
            alt=""
            aria-hidden
            onError={() => setBgOk(false)}
            className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl saturate-150"
          />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-background/60" />
        </>
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-muted/50 blur" />
      )}
      <div className="relative grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 transition-colors group-hover:bg-muted/20 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
        <BannerThumb
          jam={jam}
          day={date.getUTCDate()}
          monthShort={monthShort}
          layoutKey={layoutKey}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <InlineCode variant={meta.codeVariant}>
              {meta.glyph} {meta.label}
            </InlineCode>
          </div>
          <Text bold size="md" className="truncate whitespace-nowrap">
            {jam.title}
          </Text>
          {(jam.hashtag || jam.hosts[0] || cohosts.length > 0) && (
            <Text
              monospace
              size="xs"
              variant="muted"
              className="truncate tracking-widest whitespace-nowrap"
            >
              {[
                jam.hashtag && (
                  <span key="tag" className="font-semibold text-foreground uppercase">
                    {jam.hashtag.toUpperCase()}
                  </span>
                ),
                jam.hosts[0] && (
                  <span key="host" className="font-semibold text-foreground">
                    {jam.hosts[0].name}
                  </span>
                ),
                ...cohosts.map((h) => <span key={`co-${h.name}`}>{h.name}</span>),
              ]
                .filter(Boolean)
                .reduce<React.ReactNode[]>((acc, node, i) => {
                  if (i > 0) acc.push(<span key={`sep-${i}`}> · </span>);
                  acc.push(node);
                  return acc;
                }, [])}
            </Text>
          )}
          <Text monospace size="xs" variant="muted" className="tracking-widest">
            {formatJamShortDates(jam.startsAt, jam.endsAt) ?? "TBA"}
            {durationDays(jam.startsAt, jam.endsAt) &&
              ` · ${durationDays(jam.startsAt, jam.endsAt)}`}
          </Text>
        </div>
        <div className="flex flex-col items-end justify-center gap-0.5">
          <Text monospace size="xs" variant="muted" className="tracking-widest">
            ENTRIES
          </Text>
          <Text monospace bold size="md" className="tabular-nums">
            {(jam.entriesCount ?? 0).toLocaleString()}
          </Text>
        </div>
      </div>
    </motion.button>
  );
}

function BannerThumb({
  jam,
  day,
  monthShort,
  layoutKey,
}: {
  jam: JamFromList;
  day: number;
  monthShort: string;
  /** Same row id used for the row's own layoutId — the foreground image
   * shares this id with the modal's banner so it animates from the
   * thumb position into the modal's top banner slot. */
  layoutKey: string;
}) {
  const palette = useThemeChartColors();
  const colors = useMemo(() => jamPaletteColors(palette, jam.jamId), [palette, jam.jamId]);
  const [imageOk, setImageOk] = useState(true);
  const showImage = jam.bannerUrl && imageOk;

  return (
    <div className="relative h-20 w-full shrink-0 overflow-hidden rounded bg-muted/40">
      {showImage ? (
        <>
          <img
            src={jam.bannerUrl ?? ""}
            alt=""
            aria-hidden
            onError={() => setImageOk(false)}
            className="absolute inset-0 h-full w-full scale-125 object-cover blur-md saturate-150"
          />
          <motion.img
            layoutId={`tl-banner-${layoutKey}`}
            transition={ROW_CLOSE_TRANSITION}
            src={jam.bannerUrl ?? ""}
            alt=""
            aria-hidden
            onError={() => setImageOk(false)}
            className="absolute inset-0 h-full w-full object-contain"
          />
        </>
      ) : (
        <motion.div
          layoutId={`tl-banner-${layoutKey}`}
          transition={ROW_CLOSE_TRANSITION}
          className="absolute inset-0"
        >
          <Grainient color1={colors[0]} color2={colors[1]} color3={colors[0]} />
        </motion.div>
      )}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background/90 to-transparent"
      />
      <div className="absolute right-2 bottom-1 left-2 flex items-baseline gap-1.5">
        <Text monospace bold density="dense" className="text-2xl leading-none tabular-nums">
          {day}
        </Text>
        <Text monospace size="xs" variant="muted" className="tracking-widest">
          {monthShort}
        </Text>
      </div>
    </div>
  );
}

/** Walks up from `el` to the first ancestor that establishes its own
 * vertical scroll context, falling back to the document scrolling
 * element. Used to locate the right scroll surface for virtualization
 * when the page scroll lives on an inner container instead of window. */
function findScrollParent(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const style = window.getComputedStyle(cur);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return cur;
    cur = cur.parentElement;
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

/** Flatten the jam list into one row per scheduled event (start /
 * submission deadline / voting end). Drops any events that lack a
 * date so we don't generate ghost rows. */
function expandToEvents(jams: JamFromList[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const jam of jams) {
    if (jam.startsAt) {
      out.push({ jam, kind: "starting", date: new Date(jam.startsAt) });
    }
    if (jam.endsAt) {
      out.push({ jam, kind: "deadline", date: new Date(jam.endsAt) });
    }
    if (jam.votingEndsAt) {
      out.push({ jam, kind: "ending", date: new Date(jam.votingEndsAt) });
    }
  }
  return out;
}

/** Group events by their event-month and return them in chronological order. */
function groupByEventMonth(events: TimelineEvent[]): { key: string; entries: TimelineEvent[] }[] {
  const buckets = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const key = monthKey(e.date);
    const list = buckets.get(key) ?? [];
    list.push(e);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entries]) => ({
      key,
      entries: entries.sort((a, b) => a.date.getTime() - b.date.getTime()),
    }));
}
