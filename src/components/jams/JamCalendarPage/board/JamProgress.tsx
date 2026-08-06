import { type JamFromList, lifecycleProgress } from "../helpers";
import { useJamColor } from "./use-jam-color";

/**
 * List-row treatment: the row background IS the progress bar — a color
 * wash sweeps across the full row from start to last event, with a
 * glowing leading edge at "now" and a dashed tick where the submission
 * deadline falls. Scales to any row width.
 */
export function RowProgress({ jam, now }: { jam: JamFromList; now: Date }) {
  const rowColor = useJamColor(jam);
  const progress = lifecycleProgress(jam, now);
  if (!progress || progress.fill <= 0) return null;
  const { fill, deadlinePct } = progress;

  // Still a lit leading edge, just not a blown-out one: the hue stays
  // mostly the jam's own rather than washing to white, and the halo
  // keeps its blur but sheds most of the spread that made it bloom
  // across the row.
  const glow = `color-mix(in srgb, ${rowColor} 65%, white)`;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: `${fill * 100}%`,
          background: `linear-gradient(to right, transparent, color-mix(in srgb, ${rowColor} 12%, transparent) 60%, color-mix(in srgb, ${rowColor} 28%, transparent))`,
        }}
      />
      {fill < 1 && (
        <div
          className="absolute inset-y-0 w-0.5"
          style={{
            left: `calc(${fill * 100}% - 1px)`,
            background: glow,
            boxShadow: `0 0 8px 1px color-mix(in srgb, ${glow} 55%, transparent)`,
          }}
        />
      )}
      {deadlinePct != null && deadlinePct > 0 && deadlinePct < 100 && (
        <div
          className="absolute inset-y-0 border-l border-dashed border-warning/50"
          style={{ left: `${deadlinePct}%` }}
        />
      )}
    </div>
  );
}

/**
 * Card treatment: a strip pinned to the card's bottom edge with the
 * same flashy language as the list rows — theme-tinted track, gradient
 * fill, glowing leading edge, dashed deadline tick. Jams that haven't
 * started yet get a cheeky striped "SOON™" placeholder instead of an
 * empty bar.
 */
export function CardProgressStrip({ jam, now }: { jam: JamFromList; now: Date }) {
  const color = useJamColor(jam);

  const notStarted = jam.startsAt != null && new Date(jam.startsAt).getTime() > now.getTime();
  if (notStarted) {
    return (
      <div
        aria-hidden
        className="relative h-5 w-full shrink-0 overflow-hidden border-t border-muted/20"
        style={{
          backgroundImage:
            "repeating-linear-gradient(-45deg, transparent 0px, transparent 4px, color-mix(in srgb, var(--muted-foreground) 15%, transparent) 4px, color-mix(in srgb, var(--muted-foreground) 15%, transparent) 5px)",
        }}
      >
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] leading-none tracking-[0.25em] text-muted-foreground">
          SOON
          <sup className="text-[6px] tracking-normal">TM</sup>
        </span>
      </div>
    );
  }

  const progress = lifecycleProgress(jam, now);
  const fill = progress?.fill ?? 0;
  const deadlinePct = progress?.deadlinePct ?? null;
  const glow = `color-mix(in srgb, ${color} 30%, white)`;
  return (
    <div
      aria-hidden
      className="relative h-5 w-full shrink-0 overflow-hidden border-t border-muted/20"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {fill > 0 && (
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${fill * 100}%`,
            background: `linear-gradient(to right, color-mix(in srgb, ${color} 40%, transparent), ${color})`,
          }}
        />
      )}
      {fill > 0 && fill < 1 && (
        <div
          className="absolute inset-y-0 w-0.5"
          style={{
            left: `calc(${fill * 100}% - 1px)`,
            background: glow,
            boxShadow: `0 0 12px 3px ${glow}`,
          }}
        />
      )}
      {deadlinePct != null && deadlinePct > 0 && deadlinePct < 100 && (
        <div
          className="absolute inset-y-0 border-l border-dashed border-warning/50"
          style={{ left: `${deadlinePct}%` }}
        />
      )}
    </div>
  );
}
