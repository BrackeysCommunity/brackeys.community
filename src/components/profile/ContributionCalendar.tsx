import { Cancel01Icon, GameIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useIsTouchDevice } from "@/hooks/use-touch-device";
import type { ContributionDay } from "@/lib/github";
import { cn } from "@/lib/utils";
import { client } from "@/orpc/client";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function getIntensity(count: number, max: number): number {
  if (count === 0) return 0;
  if (max === 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

// All contribution cells render flat — intensity is communicated
// purely through colour, not elevation. The lift is reserved for
// the snake: only cells the snake currently occupies raise; once
// the snake moves on, the cell drops back to flat. That way the
// snake reads as a moving topographic ridge over an otherwise
// completely flat heatmap.
const intensityClasses = [
  "bg-muted/30",
  "bg-primary/25",
  "bg-primary/50",
  "bg-primary/75",
  "bg-primary",
] as const;
const cellBase =
  "aspect-square w-full rounded-[2px] transition-[transform,background-color,box-shadow] duration-150";
// Snake variants — head and body are the only cells that lift,
// using `chonk-emboss` with the success colour so the snake reads
// as a brighter raised ribbon riding the flat heatmap.
const snakeHeadClass =
  "chonk-emboss bg-success text-success-foreground [--emboss-shadow:color-mix(in_srgb,var(--success)_50%,black)] [--chonk-lift:2px] [--chonk-lift-hover:2px]";
const snakeBodyClass =
  "chonk-emboss bg-success/70 [--emboss-shadow:color-mix(in_srgb,var(--success)_45%,black)] [--chonk-lift:2px] [--chonk-lift-hover:2px]";
// Empty cells while playing — match level-0's flat treatment so the
// snake's lift is the only height variation on the board.
const emptyCellClass = "bg-muted/30";

// ── Snake Logic ─────────────────────────────────────────────────────────────

type Pos = { col: number; row: number };
type Dir = "up" | "down" | "left" | "right";

const TICK_MS = 110;
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const DELTA: Record<Dir, Pos> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};
function posKey(p: Pos) {
  return `${p.col},${p.row}`;
}

function useSnakeGame(cols: number, initialFood: Set<string>) {
  const startPos: Pos = { col: 0, row: 3 };
  const [snake, setSnake] = useState<Pos[]>([startPos]);
  const [dir, setDir] = useState<Dir>("right");
  const [food, setFood] = useState(() => new Set(initialFood));
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);

  const dirRef = useRef(dir);
  const queuedDir = useRef<Dir | null>(null);
  const startedRef = useRef(started);
  useEffect(() => {
    dirRef.current = dir;
  }, [dir]);
  // Mirror `started` on a ref so `handleKey` can stay stable —
  // otherwise the callback's stale closure swallows the very first
  // keypress (the one that's supposed to start the game).
  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  const handleKey = useCallback((e: KeyboardEvent) => {
    const keyMap: Record<string, Dir> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      s: "down",
      a: "left",
      d: "right",
      W: "up",
      S: "down",
      A: "left",
      D: "right",
    };
    const newDir = keyMap[e.key];
    if (newDir) {
      e.preventDefault();
      if (!startedRef.current) setStarted(true);
      if (newDir !== OPPOSITE[dirRef.current]) queuedDir.current = newDir;
    }
  }, []);

  useEffect(() => {
    if (!started || gameOver) return;
    const interval = setInterval(() => {
      if (queuedDir.current) {
        setDir(queuedDir.current);
        dirRef.current = queuedDir.current;
        queuedDir.current = null;
      }
      setSnake((prev) => {
        const head = prev[0];
        const d = DELTA[dirRef.current];
        const next: Pos = { col: head.col + d.col, row: head.row + d.row };
        if (next.col < 0 || next.col >= cols || next.row < 0 || next.row >= 7) {
          setGameOver(true);
          return prev;
        }
        const nk = posKey(next);
        if (prev.some((s) => posKey(s) === nk)) {
          setGameOver(true);
          return prev;
        }
        const ate = food.has(nk);
        if (ate) {
          setFood((f) => {
            const n = new Set(f);
            n.delete(nk);
            return n;
          });
          setScore((s) => s + 1);
        }
        const newSnake = [next, ...prev];
        if (!ate) newSnake.pop();
        return newSnake;
      });
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [started, gameOver, cols, food]);

  const snakeSet = useMemo(() => {
    const s = new Map<string, "head" | "body">();
    for (let i = 0; i < snake.length; i++) s.set(posKey(snake[i]), i === 0 ? "head" : "body");
    return s;
  }, [snake]);

  const restart = () => {
    setSnake([startPos]);
    setDir("right");
    dirRef.current = "right";
    queuedDir.current = null;
    setFood(new Set(initialFood));
    setScore(0);
    setGameOver(false);
    setStarted(false);
  };

  return { snake, snakeSet, food, score, gameOver, started, handleKey, restart };
}

// ── Unified Calendar / Snake Grid ───────────────────────────────────────────

function CalendarGrid({
  weeks,
  totalContributions,
  maxCount,
  monthHeaders,
  playing,
  onToggleSnake,
  showDayLabels = false,
  hideHeader = false,
  largeLabels = false,
}: {
  weeks: Array<{ contributionDays: ContributionDay[] }>;
  totalContributions: number;
  maxCount: number;
  monthHeaders: Array<{ label: string; col: number }>;
  playing: boolean;
  onToggleSnake: () => void;
  /** Render the leading Mon/Wed/Fri row labels. Off by default so
   * the inline card lets the grid use the full container width. The
   * fullscreen snake overlay turns it on for legibility. */
  showDayLabels?: boolean;
  /** Hide the in-grid title + score header (used by the fullscreen
   * overlay which already shows that information in its own
   * header row). */
  hideHeader?: boolean;
  /** Use a larger axis-label size — appropriate for the fullscreen
   * snake surface where the inline card's `7px` labels read as too
   * cramped. */
  largeLabels?: boolean;
}) {
  const cols = weeks.length;

  const initialFood = useMemo(() => {
    const set = new Set<string>();
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 7; r++) {
        const day = weeks[c]?.contributionDays[r];
        if (day && day.contributionCount > 0) set.add(posKey({ col: c, row: r }));
      }
    }
    return set;
  }, [weeks, cols]);

  const game = useSnakeGame(cols, initialFood);

  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleSnake();
      game.handleKey(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, game, onToggleSnake]);

  // Conditional template + leading-cell rendering. When day labels
  // are off the grid drops its first column entirely so the heatmap
  // gets the full container width — important inside the inline
  // card where every pixel of horizontal space matters.
  const gridTemplateColumns = showDayLabels
    ? `auto repeat(${cols}, minmax(0, 1fr))`
    : `repeat(${cols}, minmax(0, 1fr))`;
  const labelLeader = (content: React.ReactNode) => (showDayLabels ? <>{content}</> : null);

  return (
    <div className="relative w-full min-w-0 space-y-1.5">
      {hideHeader ? null : (
        <div className="flex items-baseline justify-between">
          <span
            className={cn(
              "font-mono text-[10px] font-bold tracking-[0.15em] uppercase transition-colors",
              playing ? "text-green-400/80" : "text-muted-foreground/50",
            )}
          >
            {playing ? "Snake" : "Contributions"}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted-foreground/40">
              {playing
                ? `${game.score} / ${totalContributions}`
                : `${totalContributions.toLocaleString()} in the last year`}
            </span>
            <Button
              type="button"
              variant={playing ? "outline" : "default"}
              size="xs"
              onClick={onToggleSnake}
              aria-label={playing ? "Exit snake" : "Play Snake"}
              className="font-mono tracking-widest"
            >
              <HugeiconsIcon icon={playing ? Cancel01Icon : GameIcon} size={12} />
              {playing ? "ESC" : "PLAY"}
            </Button>
          </div>
        </div>
      )}

      {/* Grid */}
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns,
          gridTemplateRows: "auto repeat(7, 1fr)",
          gap: "1px",
        }}
      >
        {/* Month header row */}
        {labelLeader(<div />)}
        {weeks.map((week, wi) => {
          const firstDay = week.contributionDays[0];
          const header = monthHeaders.find((h) => h.col === wi);
          const weekKey = firstDay?.date ?? `w${wi}`;
          return (
            <div key={weekKey} className="min-w-0">
              {header && (
                <span
                  className={cn(
                    "font-mono leading-none whitespace-nowrap transition-colors",
                    largeLabels ? "text-[11px]" : "text-[7px]",
                    playing && !largeLabels
                      ? "text-muted-foreground/10"
                      : "text-muted-foreground/60",
                  )}
                >
                  {header.label}
                </span>
              )}
            </div>
          );
        })}

        {/* Day rows */}
        {DAY_LABELS.map((label, row) => (
          <Fragment key={label || `day${row}`}>
            {labelLeader(
              <span
                className={cn(
                  "self-center pr-1 text-right font-mono leading-none transition-colors",
                  largeLabels ? "text-[11px]" : "text-[7px]",
                  playing && !largeLabels ? "text-muted-foreground/10" : "text-muted-foreground/60",
                )}
              >
                {label}
              </span>,
            )}
            {Array.from({ length: cols }, (_, col) => {
              const day = weeks[col]?.contributionDays[row];
              const k = posKey({ col, row });

              if (playing) {
                const snakePart = game.snakeSet.get(k);
                const isFood = game.food.has(k);
                const baseIntensity = day ? getIntensity(day.contributionCount, maxCount) : 0;

                let cellClass: string;
                if (snakePart === "head") cellClass = snakeHeadClass;
                else if (snakePart === "body") cellClass = snakeBodyClass;
                else if (isFood) cellClass = intensityClasses[baseIntensity];
                else cellClass = emptyCellClass;

                return <div key={k} className={cn(cellBase, cellClass)} />;
              }

              if (!day) return <div key={k} className="aspect-square w-full" />;
              const intensity = getIntensity(day.contributionCount, maxCount);
              return (
                <div
                  key={day.date}
                  className={cn(cellBase, intensityClasses[intensity])}
                  title={`${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Snake overlays (positioned over the grid area) */}
      {playing && !game.started && !game.gameOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="animate-pulse font-mono text-[10px] tracking-wider text-foreground/60 drop-shadow-md">
            Arrow keys to start
          </span>
        </div>
      )}
      {playing && game.gameOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-sm bg-background/70 backdrop-blur-[2px]">
          <span className="font-mono text-[10px] font-bold tracking-widest text-destructive/80 uppercase">
            Game Over
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/50">
            Score: {game.score}
          </span>
          <button
            type="button"
            onClick={game.restart}
            className="mt-0.5 font-mono text-[9px] tracking-wider text-primary/60 uppercase transition-colors hover:text-primary"
          >
            Play again
          </button>
        </div>
      )}

      {/* Legend */}
      <div
        className={cn(
          "flex items-center justify-end gap-1 transition-opacity",
          playing && "opacity-0",
        )}
      >
        <span className="mr-0.5 font-mono text-[7px] text-muted-foreground/25">Less</span>
        {intensityClasses.map((cls) => (
          <div key={cls} className={cn("h-[8px] w-[8px] rounded-[2px]", cls)} />
        ))}
        <span className="ml-0.5 font-mono text-[7px] text-muted-foreground/25">More</span>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

interface ContributionCalendarProps {
  userId: string;
  className?: string;
}

export function ContributionCalendar({ userId, className }: ContributionCalendarProps) {
  // The inline grid never enters snake mode now — the desktop modal
  // and the mobile fullscreen overlay both render their own
  // CalendarGrid in `playing` mode. Inline always shows the static
  // contribution heatmap.
  const snakeMode = false;

  const { data, isLoading } = useQuery({
    queryKey: ["contributions", userId],
    queryFn: () => client.getContributions({ userId }),
    staleTime: 1000 * 60 * 30,
    retry: false,
  });

  const maxCount = useMemo(
    () =>
      data
        ? Math.max(
            1,
            ...data.weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)),
          )
        : 1,
    [data],
  );

  const monthHeaders = useMemo(() => {
    if (!data) return [];
    const headers: Array<{ label: string; col: number }> = [];
    let lastMonth = -1;
    for (let wi = 0; wi < data.weeks.length; wi++) {
      const firstDay = data.weeks[wi].contributionDays[0];
      if (!firstDay) continue;
      const month = new Date(firstDay.date).getMonth();
      if (month !== lastMonth) {
        headers.push({ label: MONTH_LABELS[month], col: wi });
        lastMonth = month;
      }
    }
    return headers;
  }, [data]);

  const isTouch = useIsTouchDevice();
  // Desktop opens snake in a centred Dialog modal (chonky surface
  // matching the jam detail spotlight); touch opens the rotated
  // landscape overlay with on-screen controls.
  const [fullscreen, setFullscreen] = useState(false);
  const [desktopModal, setDesktopModal] = useState(false);

  if (isLoading) {
    return (
      <div className={cn("px-3 py-3 sm:px-5 sm:py-4", className)}>
        <div className="animate-pulse space-y-2">
          <div className="h-2.5 w-20 rounded-sm bg-muted/40" />
          <div className="h-[82px] rounded-sm bg-muted/20" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Mobile / touch viewers play snake fullscreen — the inline grid
  // is too small to control comfortably, and rotating the phone
  // landscape lets us fit a chunky control pad next to the board.
  // Desktop viewers open a centred modal so the snake game gets
  // dedicated focus + a comfortable size, mirroring the jam detail
  // spotlight pattern from the jam page.
  const handleToggleSnake = () => {
    if (isTouch) setFullscreen((v) => !v);
    else setDesktopModal((v) => !v);
  };

  return (
    <>
      <div className={cn("relative border-b border-muted/40 px-3 py-3 sm:px-5 sm:py-4", className)}>
        <CalendarGrid
          weeks={data.weeks}
          totalContributions={data.totalContributions}
          maxCount={maxCount}
          monthHeaders={monthHeaders}
          playing={snakeMode}
          onToggleSnake={handleToggleSnake}
        />
      </div>
      {fullscreen ? (
        <SnakeFullscreenOverlay
          weeks={data.weeks}
          totalContributions={data.totalContributions}
          maxCount={maxCount}
          monthHeaders={monthHeaders}
          onClose={() => setFullscreen(false)}
        />
      ) : null}
      <SnakeDesktopModal
        open={desktopModal}
        onOpenChange={setDesktopModal}
        weeks={data.weeks}
        totalContributions={data.totalContributions}
        maxCount={maxCount}
        monthHeaders={monthHeaders}
      />
    </>
  );
}

// ── Mobile fullscreen snake overlay ────────────────────────────────

import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { createPortal } from "react-dom";

/**
 * Full-screen landscape snake overlay used on touch devices. The
 * inner content rotates 90° when the device is portrait so the user
 * sees a wide playfield + adjacent D-pad regardless of how they
 * hold the phone. Browser-history `popstate` (system back gesture)
 * and the on-screen X both close the overlay.
 */
function SnakeFullscreenOverlay({
  weeks,
  totalContributions,
  maxCount,
  monthHeaders,
  onClose,
}: {
  weeks: Array<{ contributionDays: ContributionDay[] }>;
  totalContributions: number;
  maxCount: number;
  monthHeaders: Array<{ label: string; col: number }>;
  onClose: () => void;
}) {
  const [portrait, setPortrait] = useState(false);

  // Track viewport orientation. The whole overlay rotates 90° when
  // the phone is held portrait so the playfield always reads
  // landscape — touch users get a wide canvas with the controls
  // below regardless of how they're holding the device.
  useEffect(() => {
    const check = () => setPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // ESC dismisses; browser back gesture (popstate) does too. We push
  // a sentinel history entry on mount so the system back button just
  // exits the overlay rather than navigating away from the profile.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPop = () => onClose();
    window.history.pushState({ snake: true }, "");
    window.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
  }, [onClose]);

  // Lock body scroll while the overlay is up so swipe gestures don't
  // bleed into the page underneath.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  if (typeof document === "undefined") return null;

  // When the viewport is portrait we rotate 90° so the inner box
  // gets the viewport's height as its width and vice versa. The
  // children layout themselves landscape-first; the rotation just
  // re-frames it for whatever orientation the user holds the phone.
  const w = portrait ? window.innerHeight : window.innerWidth;
  const h = portrait ? window.innerWidth : window.innerHeight;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-background">
      <div
        className="flex flex-col"
        style={{
          width: w,
          height: h,
          transform: portrait ? "rotate(90deg)" : undefined,
          transformOrigin: "center center",
        }}
      >
        <header className="flex items-center justify-between border-b border-muted/30 px-4 py-3">
          <div className="flex flex-col">
            <span className="font-mono text-[11px] font-bold tracking-widest text-success uppercase">
              Snake
            </span>
            <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              {totalContributions.toLocaleString()} contributions
            </span>
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Close"
            onClick={onClose}
            className="font-mono"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        </header>

        {/* Game fills the available width; vertically centred so
            the tile rows have breathing room above the controls. */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-4">
          <div className="w-full">
            <CalendarGrid
              weeks={weeks}
              totalContributions={totalContributions}
              maxCount={maxCount}
              monthHeaders={monthHeaders}
              playing
              onToggleSnake={onClose}
              showDayLabels
              hideHeader
              largeLabels
            />
          </div>
        </div>

        {/* Inverted-T keyboard arrow controls below the playfield,
            anchored to the right so the user's right thumb falls
            naturally on the cluster while the game stays centred. */}
        <SnakeKeyboardControls />
      </div>
    </div>,
    document.body,
  );
}

/** Inverted-T arrow controls. Each button dispatches a synthetic
 * `KeyboardEvent` so the existing `useSnakeGame.handleKey` listener
 * inside `CalendarGrid` picks them up — no game state lifting. */
function SnakeKeyboardControls() {
  const dispatch = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true });
    window.dispatchEvent(event);
  };
  return (
    <div
      className="flex justify-end border-t border-muted/30 px-4 pt-3"
      style={{
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        paddingRight: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <Button
          variant="default"
          size="icon-lg"
          aria-label="Up"
          onClick={() => dispatch("ArrowUp")}
          className="h-12 w-14"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={20} />
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="icon-lg"
            aria-label="Left"
            onClick={() => dispatch("ArrowLeft")}
            className="h-12 w-14"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
          </Button>
          <Button
            variant="default"
            size="icon-lg"
            aria-label="Down"
            onClick={() => dispatch("ArrowDown")}
            className="h-12 w-14"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={20} />
          </Button>
          <Button
            variant="default"
            size="icon-lg"
            aria-label="Right"
            onClick={() => dispatch("ArrowRight")}
            className="h-12 w-14"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={20} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Desktop snake modal ────────────────────────────────────────────

import { AnimatePresence, motion } from "framer-motion";

/**
 * Desktop snake spotlight. Custom Chonk-styled overlay that mirrors
 * the jam detail spotlight on the jams page — chonky border + drop
 * shadow, blurred backdrop, ESC chip, click-out to dismiss. Built
 * directly with framer-motion + a portal so the surface gets the same
 * embossed treatment as `JamDetailModal` (rather than the generic
 * Dialog primitive, which caps width at `sm` and steals keyboard
 * input via its own focus trap).
 */
function SnakeDesktopModal({
  open,
  onOpenChange,
  weeks,
  totalContributions,
  maxCount,
  monthHeaders,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  weeks: Array<{ contributionDays: ContributionDay[] }>;
  totalContributions: number;
  maxCount: number;
  monthHeaders: Array<{ label: string; col: number }>;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            key="snake-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
            style={{ touchAction: "none" }}
          />
          <motion.div
            key="snake-modal"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.18 }}
            style={{ borderRadius: 12 }}
            className="fixed inset-0 z-50 m-auto flex h-fit max-h-[90vh] w-[min(72rem,calc(100vw-2rem))] cursor-default flex-col overflow-hidden border border-[var(--emboss-shadow)] bg-card text-foreground shadow-[0_16px_0_0_var(--emboss-shadow)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-muted/40 px-5 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-xs font-bold tracking-widest uppercase">Snake</span>
                <span className="font-mono text-[10px] tracking-widest text-muted-foreground/70 uppercase">
                  Arrow keys or WASD · ESC to exit
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="shrink-0 rounded-md bg-background/80 px-2 py-1 font-mono text-[10px] tracking-widest text-foreground backdrop-blur-sm transition-colors hover:bg-background"
              >
                ESC
              </button>
            </div>
            <div className="relative min-w-0 flex-1 px-5 py-5">
              <CalendarGrid
                weeks={weeks}
                totalContributions={totalContributions}
                maxCount={maxCount}
                monthHeaders={monthHeaders}
                playing
                onToggleSnake={() => onOpenChange(false)}
                showDayLabels
                largeLabels
                hideHeader
              />
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
