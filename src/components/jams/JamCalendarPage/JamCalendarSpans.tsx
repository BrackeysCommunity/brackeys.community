import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutGroup, motion } from "framer-motion";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { jamDate } from "@/lib/jam-links";
import { cn } from "@/lib/utils";

import { dayCellLayoutId, DayDetailModal } from "./DayDetailPanel";
import {
  type DayBuckets,
  dayKey,
  isOngoing,
  isSameDay,
  isSameMonth,
  type JamFromList,
  jamSignal,
  monthGridDays,
  safeThemeColor,
} from "./helpers";
import { JamDetailModal } from "./JamDetailModal";

const ROW_CLOSE_TRANSITION = {
  type: "spring" as const,
  stiffness: 520,
  damping: 32,
  mass: 0.7,
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface JamCalendarSpansProps {
  monthStart: Date;
  today: Date;
  jams: JamFromList[];
  byDay: Map<string, DayBuckets>;
  now: Date;
  isLoading: boolean;
  compact: boolean;
  onMonthChange: (month: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onJumpToday: () => void;
}

interface WeekBar {
  jam: JamFromList;
  lane: number;
  /** 0-6 column range this bar occupies in the week. */
  startCol: number;
  endCol: number;
  /** Fraction of the bar (day-quantized) that is submission window;
   * the remainder is the voting tail, styled dimmer. */
  subFrac: number;
  continuesLeft: boolean;
  continuesRight: boolean;
}

/**
 * Month view that draws jams as *named spans* — TV-guide style — instead
 * of per-day count badges. Each week stacks the top jams (by the
 * phase-appropriate signal) into lanes; everything else on a given day
 * is reachable through the day's "+N" chip, which opens the familiar
 * day-detail list. Spans are the honest representation: most jams run
 * for days or weeks, and a point-event badge can't show that.
 */
export function JamCalendarSpans({
  monthStart,
  today,
  jams,
  byDay,
  now,
  isLoading,
  compact,
  onMonthChange,
  onPrevMonth,
  onNextMonth,
  onJumpToday,
}: JamCalendarSpansProps) {
  const lanes = compact ? 2 : 3;
  const days = useMemo(() => monthGridDays(monthStart), [monthStart]);
  const weeks = useMemo(
    () => Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7)),
    [days],
  );

  const weekBars = useMemo(
    () => weeks.map((week) => buildWeekBars(week, jams, now, lanes)),
    [weeks, jams, now, lanes],
  );

  const [selected, setSelected] = useState<{ jam: JamFromList; layoutKey: string } | null>(null);
  const [detailDay, setDetailDay] = useState<Date | null>(null);

  const monthLabel = jamDate(monthStart, { month: "long" }).toUpperCase();

  return (
    <LayoutGroup>
      {/* `inert` while the day spotlight is open makes the whole
          calendar unfocusable and non-interactive, so tabbing can't
          land on a cell or bar hidden behind the backdrop. */}
      <Well inert={detailDay != null ? true : undefined} className="flex flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-muted/30 px-3 py-2">
          <ButtonGroup className="[&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md">
            <Button
              variant="outline"
              size="sm"
              onClick={onPrevMonth}
              aria-label="Previous month"
              className="px-2"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onNextMonth}
              aria-label="Next month"
              className="px-2"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onJumpToday}
              aria-label="Jump to current month"
              className="px-2.5 text-[11px] tracking-widest"
            >
              TODAY
            </Button>
          </ButtonGroup>
          <Text bold size="md" className="ml-2 tracking-widest">
            {monthLabel}
          </Text>
          <Text size="md" variant="muted" className="tracking-widest">
            {monthStart.getUTCFullYear()}
          </Text>
          <Text size="xs" variant="muted" className="ml-auto hidden tracking-widest sm:block">
            BARS = TOP JAMS BY SIZE · CLICK A DAY FOR EVERYTHING
          </Text>
        </header>

        <div className="grid grid-cols-7 border-b border-muted/30">
          {WEEKDAYS.map((d) => (
            <Text
              key={d}
              as="div"
              size="xs"
              variant="muted"
              className="px-1.5 py-1.5 text-[10px] tracking-widest uppercase"
            >
              {d}
            </Text>
          ))}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-px p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={cn("w-full", compact ? "h-20" : "h-28")} />
            ))}
          </div>
        ) : (
          weeks.map((week, w) => (
            <WeekRow
              key={dayKey(week[0]!)}
              week={week}
              bars={weekBars[w]!}
              monthStart={monthStart}
              today={today}
              byDay={byDay}
              compact={compact}
              selectedLayoutKey={selected?.layoutKey ?? null}
              onBarClick={(jam, layoutKey) => setSelected({ jam, layoutKey })}
              onDayClick={(day) => {
                setDetailDay(day);
                if (!isSameMonth(day, monthStart)) onMonthChange(day);
              }}
            />
          ))
        )}
      </Well>

      <JamDetailModal
        jam={selected?.jam ?? null}
        layoutKey={selected?.layoutKey ?? null}
        onClose={() => setSelected(null)}
      />

      <DayDetailModal
        day={detailDay}
        buckets={detailDay ? byDay.get(dayKey(detailDay)) : undefined}
        onClose={() => setDetailDay(null)}
      />
    </LayoutGroup>
  );
}

function WeekRow({
  week,
  bars,
  monthStart,
  today,
  byDay,
  compact,
  selectedLayoutKey,
  onBarClick,
  onDayClick,
}: {
  week: Date[];
  bars: WeekBar[];
  monthStart: Date;
  today: Date;
  byDay: Map<string, DayBuckets>;
  compact: boolean;
  selectedLayoutKey: string | null;
  onBarClick: (jam: JamFromList, layoutKey: string) => void;
  onDayClick: (day: Date) => void;
}) {
  const weekKey = dayKey(week[0]!);
  return (
    <div className="relative border-b border-muted/20 last:border-b-0">
      <div className="grid grid-cols-7 [&>button]:border-r [&>button]:border-muted/20 [&>button:nth-child(7n)]:border-r-0">
        {week.map((day) => {
          const key = dayKey(day);
          const buckets = byDay.get(key);
          const eventCount =
            (buckets?.starting.length ?? 0) +
            (buckets?.deadline.length ?? 0) +
            (buckets?.ending.length ?? 0);
          const outside = !isSameMonth(day, monthStart);
          const isToday = isSameDay(day, today);
          return (
            <motion.button
              key={key}
              type="button"
              // Every cell is a tracked source/destination for the day
              // spotlight's grow + shrink. `layout={false}` keeps that
              // shared morph while opting out of self-layout animation,
              // so month nav and `useDateNow` re-renders don't spring
              // the cells around.
              layoutId={dayCellLayoutId(day)}
              layout={false}
              transition={ROW_CLOSE_TRANSITION}
              style={{ borderRadius: 4 }}
              onClick={() => onDayClick(day)}
              aria-label={`Details for ${jamDate(day, { month: "long", day: "numeric" })}`}
              className={cn(
                "group/day flex cursor-pointer flex-col items-start gap-0.5 px-1.5 py-1 text-left transition-colors hover:bg-muted/30",
                // Reserve room below the day number for the bar lanes.
                compact ? "min-h-20" : "min-h-28",
                outside && "opacity-30",
                isToday &&
                  "bg-[image:repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_srgb,var(--color-foreground)_12%,transparent)_8px_10px)]",
              )}
            >
              <span className="flex w-full items-baseline justify-between gap-1">
                <Text
                  as="span"
                  size={compact ? "xs" : "sm"}
                  density="dense"
                  bold={isToday}
                  className={cn("tabular-nums", isToday && "text-accent")}
                >
                  {day.getUTCDate()}
                </Text>
                {eventCount > 0 && (
                  <Text
                    as="span"
                    size="xs"
                    variant="muted"
                    className="text-[9px] tracking-widest tabular-nums group-hover/day:text-foreground"
                  >
                    +{eventCount}
                  </Text>
                )}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Lane overlay — bars sit on a 7-col grid aligned with the cells
          above, offset below the day-number line. pointer-events pass
          through the empty grid so day clicks still land. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-y-0.5 pb-1",
          compact ? "top-7 auto-rows-[1.15rem]" : "top-8 auto-rows-[1.4rem]",
        )}
      >
        {bars.map((bar) => {
          const layoutKey = `cal-${weekKey}-${bar.jam.jamId}`;
          const subPct = Math.round(bar.subFrac * 100);
          // Bars carry the jam's real itch theme color when scraped;
          // the global accent is only the fallback.
          const barColor = safeThemeColor(bar.jam.themeColor) ?? "var(--color-accent)";
          return (
            <motion.button
              key={layoutKey}
              type="button"
              layoutId={`tl-row-${layoutKey}`}
              layout={false}
              transition={ROW_CLOSE_TRANSITION}
              onClick={() => onBarClick(bar.jam, layoutKey)}
              title={bar.jam.title}
              style={{
                gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`,
                gridRow: bar.lane + 1,
                opacity: selectedLayoutKey === layoutKey ? 0 : 1,
                // Submission window in solid tint; the voting tail (if
                // any) rides the same bar at lower alpha.
                background: `linear-gradient(to right, color-mix(in srgb, ${barColor} 28%, transparent) ${subPct}%, color-mix(in srgb, ${barColor} 12%, transparent) ${subPct}%)`,
                borderColor: `color-mix(in srgb, ${barColor} 40%, transparent)`,
              }}
              className={cn(
                "pointer-events-auto z-10 mx-0.5 flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden border px-1.5 text-left transition-[filter] hover:brightness-125",
                bar.continuesLeft ? "rounded-l-none border-l-0" : "rounded-l",
                bar.continuesRight ? "rounded-r-none border-r-0" : "rounded-r",
              )}
            >
              {bar.continuesLeft && (
                <span aria-hidden className="shrink-0 font-mono text-[9px] text-accent">
                  ‹
                </span>
              )}
              <span className="truncate font-mono text-[10px] leading-none font-semibold tracking-wide text-foreground">
                {bar.jam.title}
              </span>
              {bar.continuesRight && (
                <span aria-hidden className="ml-auto shrink-0 font-mono text-[9px] text-accent">
                  ›
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/** UTC day index (days since epoch) — spans are day-quantized. */
function dayIndex(d: Date): number {
  return Math.floor(d.getTime() / 86_400_000);
}

/**
 * Pick and place this week's bars: jams whose [start, votingEnd|end]
 * span overlaps the week, ranked by signal, greedily packed into the
 * available lanes. Perpetual jams are excluded — a 10-year "jam" would
 * permanently occupy a lane in every week.
 */
function buildWeekBars(week: Date[], jams: JamFromList[], now: Date, lanes: number): WeekBar[] {
  const weekStartIdx = dayIndex(week[0]!);
  const weekEndIdx = weekStartIdx + 6;

  const candidates = jams
    .filter((j) => j.startsAt && j.endsAt && !isOngoing(j))
    .map((jam) => {
      const startIdx = dayIndex(new Date(jam.startsAt!));
      const endsIdx = dayIndex(new Date(jam.endsAt!));
      const spanEndIdx = jam.votingEndsAt ? dayIndex(new Date(jam.votingEndsAt)) : endsIdx;
      return { jam, startIdx, endsIdx, spanEndIdx };
    })
    .filter((c) => c.startIdx <= weekEndIdx && c.spanEndIdx >= weekStartIdx)
    .sort((a, b) => {
      const diff = jamSignal(b.jam, now).value - jamSignal(a.jam, now).value;
      return diff !== 0 ? diff : a.startIdx - b.startIdx;
    });

  const bars: WeekBar[] = [];
  for (const c of candidates) {
    const startCol = Math.max(0, c.startIdx - weekStartIdx);
    const endCol = Math.min(6, c.spanEndIdx - weekStartIdx);
    // Find the first lane where no placed bar's columns intersect ours.
    let lane = -1;
    for (let l = 0; l < lanes; l++) {
      const conflict = bars.some(
        (b) => b.lane === l && b.startCol <= endCol && b.endCol >= startCol,
      );
      if (!conflict) {
        lane = l;
        break;
      }
    }
    if (lane === -1) continue;

    const totalCols = endCol - startCol + 1;
    // Columns of this week's slice that belong to the submission window
    // (up to and including the deadline day).
    const subCols = Math.min(Math.max(c.endsIdx - weekStartIdx - startCol + 1, 0), totalCols);
    bars.push({
      jam: c.jam,
      lane,
      startCol,
      endCol,
      subFrac: totalCols > 0 ? subCols / totalCols : 1,
      continuesLeft: c.startIdx < weekStartIdx,
      continuesRight: c.spanEndIdx > weekEndIdx,
    });
  }
  return bars;
}
