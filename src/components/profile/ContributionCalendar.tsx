import { useQuery } from "@tanstack/react-query";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const intensityClasses = [
  "bg-muted/20",
  "bg-primary/20",
  "bg-primary/40",
  "bg-primary/60",
  "bg-primary/85",
] as const;

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
  useEffect(() => {
    dirRef.current = dir;
  }, [dir]);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const keyMap: Record<string, Dir> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };
      const newDir = keyMap[e.key];
      if (newDir) {
        e.preventDefault();
        if (!started) setStarted(true);
        if (newDir !== OPPOSITE[dirRef.current]) queuedDir.current = newDir;
      }
    },
    [started],
  );

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
}: {
  weeks: Array<{ contributionDays: ContributionDay[] }>;
  totalContributions: number;
  maxCount: number;
  monthHeaders: Array<{ label: string; col: number }>;
  playing: boolean;
  onToggleSnake: () => void;
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
  }, [playing, game.handleKey, onToggleSnake]);

  return (
    <div className="space-y-1.5">
      {/* Header -- identical structure in both modes */}
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
          <button
            type="button"
            onClick={onToggleSnake}
            className={cn(
              "font-mono text-[9px] px-1.5 py-0.5 rounded-sm border transition-all",
              playing
                ? "border-muted-foreground/20 text-muted-foreground/40 hover:text-muted-foreground/60 hover:border-muted-foreground/40"
                : "border-green-500/20 text-green-500/40 hover:text-green-400 hover:border-green-400/40 hover:bg-green-400/5",
            )}
            title={playing ? "Exit snake" : "Play Snake"}
          >
            {playing ? "ESC" : "🐍"}
          </button>
        </div>
      </div>

      {/* Grid */}
      <div
        className="grid w-full"
        style={{
          gridTemplateColumns: `auto repeat(${cols}, 1fr)`,
          gridTemplateRows: "auto repeat(7, 1fr)",
          gap: "1px",
        }}
      >
        {/* Month header row */}
        <div />
        {weeks.map((week, wi) => {
          const firstDay = week.contributionDays[0];
          const header = monthHeaders.find((h) => h.col === wi);
          const weekKey = firstDay?.date ?? `w${wi}`;
          return (
            <div key={weekKey} className="min-w-0">
              {header && (
                <span
                  className={cn(
                    "font-mono text-[7px] leading-none whitespace-nowrap transition-colors",
                    playing ? "text-muted-foreground/10" : "text-muted-foreground/30",
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
            <span
              className={cn(
                "font-mono text-[7px] text-right pr-0.5 self-center leading-none transition-colors",
                playing ? "text-muted-foreground/10" : "text-muted-foreground/25",
              )}
            >
              {label}
            </span>
            {Array.from({ length: cols }, (_, col) => {
              const day = weeks[col]?.contributionDays[row];
              const k = posKey({ col, row });

              if (playing) {
                const snakePart = game.snakeSet.get(k);
                const isFood = game.food.has(k);
                const baseIntensity = day ? getIntensity(day.contributionCount, maxCount) : 0;

                let cellClass: string;
                if (snakePart === "head") cellClass = "bg-green-400";
                else if (snakePart === "body") cellClass = "bg-green-500/70";
                else if (isFood) cellClass = intensityClasses[baseIntensity];
                else cellClass = "bg-muted/10";

                return (
                  <div key={k} className={cn("aspect-square w-full rounded-[2px]", cellClass)} />
                );
              }

              if (!day) return <div key={k} className="aspect-square w-full" />;
              const intensity = getIntensity(day.contributionCount, maxCount);
              return (
                <div
                  key={day.date}
                  className={cn(
                    "aspect-square w-full rounded-[2px] transition-colors",
                    intensityClasses[intensity],
                  )}
                  title={`${day.date}: ${day.contributionCount} contribution${day.contributionCount === 1 ? "" : "s"}`}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      {/* Snake overlays (positioned over the grid area) */}
      {playing && !game.started && !game.gameOver && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-mono text-[10px] text-foreground/60 tracking-wider animate-pulse drop-shadow-md">
            Arrow keys to start
          </span>
        </div>
      )}
      {playing && game.gameOver && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/70 backdrop-blur-[2px] rounded-sm">
          <span className="font-mono text-[10px] font-bold text-destructive/80 tracking-widest uppercase">
            Game Over
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/50">
            Score: {game.score}
          </span>
          <button
            type="button"
            onClick={game.restart}
            className="font-mono text-[9px] text-primary/60 hover:text-primary transition-colors tracking-wider uppercase mt-0.5"
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
        <span className="font-mono text-[7px] text-muted-foreground/25 mr-0.5">Less</span>
        {intensityClasses.map((cls) => (
          <div key={cls} className={cn("w-[8px] h-[8px] rounded-[2px]", cls)} />
        ))}
        <span className="font-mono text-[7px] text-muted-foreground/25 ml-0.5">More</span>
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
  const [snakeMode, setSnakeMode] = useState(false);

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

  if (isLoading) {
    return (
      <div className={cn("px-5 py-4", className)}>
        <div className="animate-pulse space-y-2">
          <div className="h-2.5 w-20 bg-muted/40 rounded-sm" />
          <div className="h-[82px] bg-muted/20 rounded-sm" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className={cn("px-5 py-4 border-b border-muted/40 relative", className)}>
      <CalendarGrid
        weeks={data.weeks}
        totalContributions={data.totalContributions}
        maxCount={maxCount}
        monthHeaders={monthHeaders}
        playing={snakeMode}
        onToggleSnake={() => setSnakeMode((p) => !p)}
      />
    </div>
  );
}
