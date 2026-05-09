import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Store, useStore } from "@tanstack/react-store";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DayButtonProps } from "react-day-picker";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Calendar } from "@/components/ui/calendar";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { cn } from "@/lib/utils";

import { DayDetailContent } from "./DayDetailPanel";
import { type ChipKind, type DayBuckets, dayKey } from "./helpers";

interface JamCalendarMonthGridProps {
  monthStart: Date;
  today: Date;
  selectedDay: Date;
  byDay: Map<string, DayBuckets>;
  visibleChips: Record<ChipKind, boolean>;
  /** Reduces overall sizing and pads for narrow (touch) viewports. */
  compact: boolean;
  onSelectDay: (day: Date) => void;
  onMonthChange: (month: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onJumpToday: () => void;
}

const CHIP_META: Record<
  ChipKind,
  { glyph: string; variant: "default" | "warning" | "destructive" }
> = {
  starting: { glyph: "▶", variant: "default" },
  deadline: { glyph: "⊙", variant: "warning" },
  ending: { glyph: "■", variant: "destructive" },
};

const MODAL_TRANSITION = { type: "spring" as const, duration: 0.45, bounce: 0.18 };

interface CellStoreState {
  byDay: Map<string, DayBuckets>;
  visibleChips: Record<ChipKind, boolean>;
  compact: boolean;
  /** Toggle that flips when the spotlight modal opens or closes. The
   * cells use it as their `layoutDependency` so framer-motion only
   * fires layout animations on open/close, not on month nav. */
  modalOpen: boolean;
  /** Owns the click flow for a day cell. Bypasses DayPicker's own
   * `onSelect` (which suppresses re-clicks on the already-selected
   * cell) and orchestrates the cross-month case (switch month first,
   * then open the modal on the next frame so the cell has a chance to
   * settle into its in-month position). */
  onCellClick: (day: Date, button: HTMLButtonElement) => void;
}

/**
 * Module-scope TanStack store that the day cells read from for the
 * data they need that DayPicker can't supply through `modifiers`
 * (event buckets, chip visibility, compact mode). Selection / today /
 * outside-month are read from DayPicker's `modifiers` prop directly so
 * we stay in lock-step with DayPicker's own UTC-aware computation.
 *
 * Keeping these values in a store rather than a closure factory lets
 * `JamDayButton` keep a stable component reference, so DayPicker
 * doesn't remount its 42 cells whenever the user picks a date or
 * navigates a month.
 */
const cellStore = new Store<CellStoreState>({
  byDay: new Map(),
  visibleChips: { starting: true, deadline: true, ending: true },
  compact: false,
  modalOpen: false,
  onCellClick: () => {},
});

/**
 * Holds a reference to the day cell button that triggered the
 * currently-open modal so we can return focus to it when the modal
 * closes. Lives outside the store because it's a DOM ref, not data
 * worth subscribing to.
 */
const lastClickedCellRef: { current: HTMLButtonElement | null } = { current: null };

/**
 * Month grid built on top of the project's `Calendar` UI primitive
 * (react-day-picker). Replaces the default `DayButton` with one that
 * stacks count badges (▶/⊙/■) below the day number.
 *
 * Selecting a day opens an inline modal that *grows out of the cell*
 * itself via framer-motion's shared `layoutId`: the cell button and
 * the modal share the same `layoutId`, so the modal animates from the
 * cell's bounding box to its centered destination (and back on close).
 * A backdrop dims and blurs the rest of the page; clicking the backdrop
 * or pressing Escape closes the modal.
 */
export function JamCalendarMonthGrid({
  monthStart,
  today,
  selectedDay,
  byDay,
  visibleChips,
  compact,
  onSelectDay,
  onMonthChange,
  onPrevMonth,
  onNextMonth,
  onJumpToday,
}: JamCalendarMonthGridProps) {
  // Format the header in UTC — the rest of the calendar
  // (DayPicker `timeZone="UTC"`, `dayKey`, `monthStart`) is UTC-aware
  // too. Default `toLocaleString` is local-time, which silently shows
  // the *previous* month's label when the user is west of UTC and
  // `monthStart` (UTC midnight on the 1st) sits in the previous day's
  // local evening.
  const monthLabel = monthStart
    .toLocaleString(undefined, { month: "long", timeZone: "UTC" })
    .toUpperCase();
  const yearLabel = monthStart.getUTCFullYear();
  const [open, setOpen] = useState(false);

  // Any interaction with the calendar (month nav, cell click) pins the
  // page scroll to the very bottom — after the relevant React state
  // change has committed and the new (potentially taller) layout is on
  // screen, so `scrollHeight` reflects the post-change height. Calling
  // this synchronously inside an onClick wouldn't work: the new month
  // hasn't rendered yet, so we'd scroll to the *old* bottom and the
  // freshly-revealed last row would still be below the fold.
  //
  // Skipping the initial mount means the page doesn't jump-scroll on
  // first load.
  const initialMount = useRef(true);
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    const main = document.getElementById("main-content");
    if (!main) return;
    main.scrollTo({ top: main.scrollHeight, behavior: "smooth" });
  }, [monthStart, open, selectedDay]);

  const closeModal = useCallback(() => {
    setOpen(false);
    cellStore.setState((s) => ({ ...s, modalOpen: false }));
    // Restore focus to the cell that opened the modal so the user can
    // keep navigating with the keyboard. Wait one frame for the modal's
    // exit animation to start so the focus shift doesn't fight with
    // it.
    requestAnimationFrame(() => {
      lastClickedCellRef.current?.focus();
    });
  }, []);

  // Close on Escape so keyboard users have a non-pointer dismissal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  // Lock body scroll while the modal is open so the page can't drift
  // out from under the spotlight. We capture the prior overflow so other
  // pages / providers that also lock scroll aren't trampled.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onCellClick = useCallback(
    (day: Date, button: HTMLButtonElement) => {
      // Remember which cell the user clicked so we can return keyboard
      // focus to it when the modal closes (mouse clicks on macOS don't
      // always move focus to the clicked button, so document.activeElement
      // wouldn't be reliable here).
      lastClickedCellRef.current = button;

      // Synchronously flip the cell-store flag *before* React schedules
      // the open re-render. This way every cell renders with
      // `layoutDependency=true` in the same render the modal mounts,
      // forcing framer to re-measure the cells right then. If we relied
      // on `useLayoutEffect` to flip the flag, the modal would already
      // have committed against framer's last cached cell position
      // (potentially stale after a month-nav), and the open animation
      // would visibly start from the wrong place.
      cellStore.setState((s) => ({ ...s, modalOpen: true }));

      const sameMonth =
        day.getUTCMonth() === monthStart.getUTCMonth() &&
        day.getUTCFullYear() === monthStart.getUTCFullYear();
      if (!sameMonth) {
        // Cross-month tap: switch the displayed month first, then open
        // the modal on the next frame so the cell has a chance to settle
        // into its in-month grid position before framer measures it.
        onMonthChange(day);
        requestAnimationFrame(() => {
          onSelectDay(day);
          setOpen(true);
        });
        return;
      }
      // In-month tap: open immediately. Doing this even when `day` is
      // already the selected day is what makes a re-click on the
      // selected cell re-open the modal (DayPicker's `onSelect` would
      // suppress re-clicks because the value didn't change).
      onSelectDay(day);
      setOpen(true);
    },
    [monthStart, onMonthChange, onSelectDay],
  );

  // Sync the singleton store to current props after commit. `modalOpen`
  // is intentionally NOT touched here — it's flipped inside the click
  // handler (open) and `closeModal` (close) so cells receive the new
  // value in the same render the modal mounts/unmounts, giving framer
  // the chance to re-measure before the layout transition starts.
  useLayoutEffect(() => {
    const current = cellStore.state;
    if (
      current.byDay !== byDay ||
      current.visibleChips !== visibleChips ||
      current.compact !== compact ||
      current.onCellClick !== onCellClick
    ) {
      cellStore.setState((s) => ({
        ...s,
        byDay,
        visibleChips,
        compact,
        onCellClick,
      }));
    }
  }, [byDay, visibleChips, compact, onCellClick]);

  // Stable across renders — `JamDayButton` itself reads everything it
  // needs from `cellStore`, so this object never has to change.
  const components = useMemo(() => ({ DayButton: JamDayButton }), []);

  const selectedKey = dayKey(selectedDay);
  const selectedBuckets = byDay.get(selectedKey);

  // Namespaces the layoutIds for this calendar instance so two grids on
  // the same page (or HMR-leftover trees) don't collide.
  const groupId = useId();

  return (
    <LayoutGroup id={groupId}>
      {/* Override the chonk-deboss focus rules on the Well — they're
          intended for inputs (the whole input lights up while focused),
          but here they would tint the entire calendar border every
          time a day cell receives keyboard focus. The chonk-deboss
          rule fires on three selectors (`:focus-visible`,
          `:focus-within`, `:has(:focus-visible)`); we override all
          three with `!important` so the calendar Well stays neutral
          regardless of which descendant is focused.
          `inert` while the modal is open makes the entire calendar
          subtree unfocusable + non-interactive, so arrow-key nav and
          Enter/Space can't fire on cells behind the spotlight. */}
      <Well
        inert={open ? true : undefined}
        className={cn(
          "flex flex-col",
          "focus-within:border-input! focus-within:shadow-[inset_0_2px_0_0_var(--deboss-shadow)]!",
          "focus-visible:border-input! focus-visible:shadow-[inset_0_2px_0_0_var(--deboss-shadow)]!",
          "[&:has(*:focus-visible)]:border-input! [&:has(*:focus-visible)]:shadow-[inset_0_2px_0_0_var(--deboss-shadow)]!",
        )}
      >
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
              aria-label="Jump to today"
              className="px-2.5 font-mono text-[11px] tracking-widest"
            >
              TODAY
            </Button>
          </ButtonGroup>
          <Text monospace bold size="md" className="ml-2 tracking-widest">
            {monthLabel}
          </Text>
          <Text monospace size="md" variant="muted" className="tracking-widest">
            {yearLabel}
          </Text>
        </header>

        <Calendar
          mode="single"
          // Keep DayPicker in UTC to match the rest of the project (jam
          // timestamps, dayKey, monthStart) — without this, local-tz
          // rounding silently shifts the displayed month and click target.
          timeZone="UTC"
          month={monthStart}
          onMonthChange={onMonthChange}
          selected={selectedDay}
          // We deliberately leave `onSelect` empty: the day click flow
          // is owned by `JamDayButton` → `cellStore.onCellClick` so we
          // can re-open the modal on a re-click of the selected cell
          // (which DayPicker's `onSelect` would skip) and orchestrate
          // the cross-month sequencing.
          onSelect={() => {}}
          today={today}
          showOutsideDays
          hideNavigation
          components={components}
          // `bg-transparent!` lets the Well's `bg-card` surface show
          // through (the Calendar primitive defaults to `bg-background`,
          // which reads darker than the rest of the page chrome).
          className={cn(
            "w-full bg-transparent! p-0",
            compact ? "[--cell-size:--spacing(18)]" : "[--cell-size:--spacing(24)]",
          )}
          classNames={{
            months: "flex w-full",
            month: "flex w-full flex-col gap-0",
            month_caption: "hidden",
            weekdays:
              "grid grid-cols-7 border-b border-muted/30 [&>div]:px-1.5 [&>div]:py-1.5 [&>div]:text-[10px] [&>div]:tracking-widest [&>div]:font-mono [&>div]:text-muted-foreground [&>div]:text-left [&>div]:uppercase",
            week: "grid grid-cols-7 [&>td]:border-r [&>td]:border-b [&>td]:border-muted/20 [&>td:nth-child(7n)]:border-r-0",
            day: "relative h-(--cell-size) w-full overflow-hidden p-0 text-left",
            today: "",
          }}
        />
      </Well>

      {/* Portal the spotlight to body so its viewport-fixed position
          isn't influenced by the calendar's place in the page (or any
          ancestor scroll container). LayoutGroup still wraps both the
          cell tree and this portal call, so framer-motion tracks the
          shared `layoutId` across the DOM boundary. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open ? (
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => closeModal()}
                className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
                // `touch-action: none` blocks touch scroll chaining in
                // mobile browsers; the body-overflow lock above
                // prevents wheel scroll on desktop. (We don't attach a
                // React `onWheel={preventDefault}` because React's
                // event listeners are passive and `preventDefault` is
                // a no-op there.)
                style={{ touchAction: "none" }}
              />
            ) : null}
          </AnimatePresence>,
          document.body,
        )}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open ? (
              <motion.div
                key="modal"
                layoutId={`day-cell-${selectedKey}`}
                transition={MODAL_TRANSITION}
                style={{ borderRadius: 12 }}
                // Centered via pure CSS (`inset-0 m-auto h-fit`) so we
                // don't introduce a static `translate` that would
                // compete with framer-motion's layout-animation
                // transform.
                //
                // We deliberately *don't* apply the `chonk-emboss`
                // class here: that class adds its own
                // `transform: translateY(-N)` to fake a lift, and
                // framer-motion's layout transform overwrites it,
                // killing the lift. Instead we replicate the chonky
                // look statically with a `border` in the emboss color
                // and a deep `box-shadow` stripe. NodeCard-sized 16px
                // depth.
                className="fixed inset-0 z-50 m-auto h-fit max-h-[80vh] w-[min(28rem,calc(100vw-2rem))] cursor-default overflow-hidden border border-[var(--emboss-shadow)] bg-card text-foreground shadow-[0_16px_0_0_var(--emboss-shadow)]"
              >
                <div className="flex max-h-[80vh] flex-col overflow-y-auto pb-3">
                  <DayDetailContent day={selectedDay} buckets={selectedBuckets} />
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>,
          document.body,
        )}
    </LayoutGroup>
  );
}

/**
 * Stable day-cell renderer.
 *
 * Outside-month / selected / today states come from DayPicker's
 * `modifiers` directly — DayPicker is already doing UTC-aware
 * comparisons against the current `month` / `selected` / `today` props
 * we passed it, and trying to recompute these locally against `day.date`
 * was producing wrong answers depending on timezone offsets.
 *
 * `layoutId` is applied only to the *selected* cell so framer-motion
 * has exactly one cell to morph between when the modal opens and
 * closes. Non-selected cells have no layout transition, which keeps
 * the calendar reactive (dim updates instantly on month nav) without
 * the slow spring chasing every cell that exists in two adjacent
 * months. The selected cell's `MODAL_TRANSITION` is what drives both
 * the cell→modal grow and the modal→cell shrink (per framer's
 * destination-transition rule, the destination element's `transition`
 * is what's used for shared layout transitions).
 *
 * Bucket data + chip visibility + compact mode come from `cellStore`
 * (DayPicker has no notion of those).
 */
function JamDayButton({ day, modifiers, className, ...props }: DayButtonProps) {
  const { byDay, visibleChips, compact, modalOpen, onCellClick } = useStore(cellStore);

  // DayPicker drives keyboard navigation by toggling `modifiers.focused`
  // on whichever cell should currently hold focus (arrow keys, etc.).
  // The default `CalendarDayButton` in our `Calendar` primitive does
  // this same focus dance — replicate it here or arrow-key navigation
  // is silently broken.
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (modifiers.focused) buttonRef.current?.focus();
  }, [modifiers.focused]);

  const key = dayKey(day.date);
  const buckets = byDay.get(key);
  const counts = {
    starting: visibleChips.starting ? (buckets?.starting.length ?? 0) : 0,
    deadline: visibleChips.deadline ? (buckets?.deadline.length ?? 0) : 0,
    ending: visibleChips.ending ? (buckets?.ending.length ?? 0) : 0,
  };

  return (
    <motion.button
      ref={buttonRef}
      // Every cell has a stable `layoutId` so framer-motion has a
      // tracked source/destination for the modal grow + shrink. To
      // stop month-nav from spring-animating cells that exist in both
      // adjacent month views (Apr 26 in April vs the same date in
      // May), `layoutDependency` is gated on the modal-open flag —
      // framer only re-evaluates layout when that flips. With
      // modalOpen unchanged, layout shifts (month nav, useDateNow
      // re-renders) are ignored.
      layoutId={`day-cell-${key}`}
      layoutDependency={modalOpen}
      transition={MODAL_TRANSITION}
      type="button"
      style={{ borderRadius: 4 }}
      className={cn(
        "group/day-btn flex h-full w-full flex-col items-stretch gap-0.5 overflow-hidden text-left transition-colors",
        compact ? "px-1 py-1" : "px-1.5 py-1.5",
        "hover:bg-muted/30 active:bg-muted/40",
        // `!` (Tailwind v4 important) so the dim wins against any
        // `opacity: 1` framer-motion may have parked inline on the
        // motion.button as part of its shared-layoutId tracking.
        modifiers.outside && "opacity-30!",
        modifiers.selected && "bg-primary/5 ring-2 ring-primary ring-inset",
        // Diagonal stripe for today + selected — applied via class so
        // it survives any inline-style churn from framer-motion's
        // layout animation.
        (modifiers.today || modifiers.selected) &&
          "bg-[image:repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_srgb,var(--color-foreground)_15%,transparent)_8px_10px)]",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset",
        className,
      )}
      // Forward DayPicker's keyboard / focus / pointer handlers,
      // tabIndex, disabled and aria-label individually rather than
      // relying on a spread cast — that way nothing here can quietly
      // drop a handler and break keyboard navigation.
      tabIndex={props.tabIndex}
      disabled={props.disabled}
      onKeyDown={props.onKeyDown}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      aria-label={props["aria-label"]}
      onClick={(e) => onCellClick(day.date, e.currentTarget)}
    >
      <Text
        as="span"
        monospace
        size={compact ? "xs" : "sm"}
        density="dense"
        bold={modifiers.today}
        className={cn("tabular-nums", modifiers.today && "text-accent")}
      >
        {day.date.getUTCDate()}
      </Text>
      <div className="flex flex-col items-start gap-0.5">
        {(Object.keys(CHIP_META) as ChipKind[]).map((kind) => {
          const count = counts[kind];
          if (count <= 0) return null;
          const meta = CHIP_META[kind];
          return (
            <Badge
              key={kind}
              variant={meta.variant}
              className="h-4 gap-0.5 px-1 font-mono text-[9px] tracking-widest tabular-nums"
            >
              <span aria-hidden>{meta.glyph}</span>
              {count}
            </Badge>
          );
        })}
      </div>
    </motion.button>
  );
}
