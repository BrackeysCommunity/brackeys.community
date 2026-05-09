import { motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";

import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import type { ChipKind, ViewMode } from "./helpers";
import type { TimelineRange } from "./shared-types";

interface JamCalendarToolbarProps {
  view: ViewMode;
  visibleChips: Record<ChipKind, boolean>;
  onToggleChip: (kind: ChipKind) => void;
  search: string;
  onSearchChange: (q: string) => void;
  totalShown: number;
  totalAll: number;
  /** Timeline range — only rendered (inline with search) when
   * `view === "timeline"`. */
  timelineRange: TimelineRange;
  onTimelineRangeChange: (r: TimelineRange) => void;
  /** Stack the rows on narrow viewports rather than rendering a single
   * wide bar (matches the touch / mobile mock). */
  layout: "wide" | "stacked";
}

const ROUNDED_GROUP = "[&>*:first-child]:rounded-l-md [&>*:last-child]:rounded-r-md";

/**
 * The horizontal filter rail above the calendar — view mode toggle,
 * chip-visibility toggles, search input, and a counter. Layout switches
 * between a single wide row (desktop) and stacked rows (touch / narrow
 * desktop windows) via the `layout` prop.
 */
export function JamCalendarToolbar({
  view,
  visibleChips,
  onToggleChip,
  search,
  onSearchChange,
  totalShown,
  totalAll,
  timelineRange,
  onTimelineRangeChange,
  layout,
}: JamCalendarToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          layout === "wide" ? "" : "flex-col items-stretch",
        )}
      >
        <ChipVisibilityToggle visibleChips={visibleChips} onToggleChip={onToggleChip} />
      </div>

      {view === "timeline" ? (
        <SearchWithRange
          search={search}
          onSearchChange={onSearchChange}
          timelineRange={timelineRange}
          onTimelineRangeChange={onTimelineRangeChange}
        />
      ) : (
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder="search jams, hosts, themes"
          autoComplete="off"
          containerClassName="min-w-64"
          className="font-mono text-[11px] tracking-widest"
        />
      )}
      <Text
        monospace
        size="xs"
        variant="muted"
        align="right"
        className="tracking-widest tabular-nums"
      >
        {totalShown}/{totalAll} JAMS
      </Text>
    </div>
  );
}

/**
 * Search input with the timeline UPCOMING/ALL toggle anchored to its
 * right edge. Both controls always occupy the same row. On focus, the
 * search field grows over the toggle (spring) and the toggle fades out
 * in place so it doesn't shift; on blur, both reverse.
 */
function SearchWithRange({
  search,
  onSearchChange,
  timelineRange,
  onTimelineRangeChange,
}: {
  search: string;
  onSearchChange: (q: string) => void;
  timelineRange: TimelineRange;
  onTimelineRangeChange: (r: TimelineRange) => void;
}) {
  const toggleRef = useRef<HTMLDivElement>(null);
  const [toggleWidth, setToggleWidth] = useState(0);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const el = toggleRef.current;
    if (!el) return;
    const measure = () => setToggleWidth(el.offsetWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 12px = the gap between the field and the toggle. We pad the search's
  // right by the toggle width + gap so the resting state leaves room for
  // it; on focus, that padding collapses to 0 and the field's width
  // animates to fill the row.
  const restingRight = toggleWidth ? toggleWidth + 12 : 0;

  return (
    <div className="relative flex h-9 w-full items-center">
      <div ref={toggleRef} className="absolute top-1/2 right-0 -translate-y-1/2">
        <motion.div
          animate={{ opacity: focused ? 0 : 1 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ pointerEvents: focused ? "none" : "auto" }}
        >
          <SegmentedControl
            size="sm"
            priority="default"
            value={timelineRange}
            onChange={(v) => v && onTimelineRangeChange(v as TimelineRange)}
            aria-label="Timeline range"
            className={ROUNDED_GROUP}
          >
            <SegmentedControl.Item value="upcoming">UPCOMING</SegmentedControl.Item>
            <SegmentedControl.Item value="all">ALL</SegmentedControl.Item>
          </SegmentedControl>
        </motion.div>
      </div>
      <motion.div
        className="absolute inset-y-0 left-0 z-10"
        initial={false}
        animate={{ right: focused ? 0 : restingRight }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
      >
        <SearchField
          value={search}
          onChange={onSearchChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="search jams, hosts, themes"
          autoComplete="off"
          containerClassName="h-full w-full"
          className="font-mono text-[11px] tracking-widest"
        />
      </motion.div>
    </div>
  );
}

/**
 * Multi-select toggle row for chip visibility. Uses the same chonk
 * outline treatment as `SegmentedControl` so the two groups read as a
 * matched pair, but supports independent on/off per item rather than
 * single-select.
 */
function ChipVisibilityToggle({
  visibleChips,
  onToggleChip,
}: {
  visibleChips: Record<ChipKind, boolean>;
  onToggleChip: (kind: ChipKind) => void;
}) {
  const items: { kind: ChipKind; label: string; glyph: string }[] = [
    { kind: "starting", label: "STARTING", glyph: "▶" },
    { kind: "deadline", label: "DEADLINES", glyph: "⊙" },
    { kind: "ending", label: "ENDING", glyph: "■" },
  ];
  const value = items.filter((it) => visibleChips[it.kind]).map((it) => it.kind);
  return (
    <ToggleGroup
      multiple
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next: string[]) => {
        for (const it of items) {
          const wantsOn = (next as ChipKind[]).includes(it.kind);
          if (wantsOn !== visibleChips[it.kind]) onToggleChip(it.kind);
        }
      }}
      aria-label="Chip visibility"
      className={cn("h-7", ROUNDED_GROUP)}
    >
      {items.map((it) => (
        <ToggleGroupItem
          key={it.kind}
          value={it.kind}
          // Solid surface in the inactive state too — the default
          // outline toggle is `bg-transparent`, which reads as a
          // "missing" pill against the embossed page chrome. `bg-card`
          // matches the SegmentedControl's default item background.
          className="h-7 bg-card! px-2.5 font-mono text-[11px] tracking-widest"
        >
          <span aria-hidden className="inline-block w-3 text-center">
            {it.glyph}
          </span>
          {it.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
