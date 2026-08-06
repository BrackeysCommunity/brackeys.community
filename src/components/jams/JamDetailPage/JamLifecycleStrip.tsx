import { Text } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { MILESTONE_GLYPH, SUPPORTING_TEXT } from "../JamCalendarPage/board/milestones";
import { useJamColor } from "../JamCalendarPage/board/use-jam-color";
import {
  clamp01,
  type JamFromList,
  lifecycleProgress,
  lifecyclePoints,
} from "../JamCalendarPage/helpers";

const GLYPH_TINT = {
  starting: "text-primary",
  deadline: "text-warning",
  ending: "text-destructive",
} as const;

/**
 * The jam's arc, full width: a track from the start date to the last
 * event with the elapsed portion filled, a glowing edge at "now", and a
 * labelled node at every milestone.
 *
 * Same colour language as the board's row wash and card strip (`
 * JamProgress`) — this is that strip with room to name its nodes, which
 * is the one thing a card can't afford. The nodes are positioned
 * proportionally rather than distributed evenly: a jam whose voting
 * window is three times its submission window should *look* like that.
 */
export function JamLifecycleStrip({ jam, now }: { jam: JamFromList; now: Date }) {
  const color = useJamColor(jam);
  const points = lifecyclePoints(jam);
  const progress = lifecycleProgress(jam, now);

  // One known date (or none) can't be a track. A single date still gets
  // named — that's most of the archive.
  if (points.length < 2 || !progress) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {points.map((point) => (
          <NodeLabel key={point.kind} point={point} now={now} />
        ))}
        {points.length === 0 ? (
          <Text size="xs" variant="muted" className={cn(SUPPORTING_TEXT, "tracking-widest")}>
            DATES TBA
          </Text>
        ) : null}
      </div>
    );
  }

  const t0 = points[0]!.date.getTime();
  const t1 = points[points.length - 1]!.date.getTime();
  const span = t1 - t0;
  const fillPct = progress.fill * 100;
  const glow = `color-mix(in srgb, ${color} 40%, white)`;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative h-2 w-full overflow-hidden rounded-full"
        style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${fillPct}%`,
            background: `linear-gradient(to right, color-mix(in srgb, ${color} 45%, transparent), ${color})`,
          }}
        />
        {fillPct > 0 && fillPct < 100 ? (
          <div
            aria-hidden
            className="absolute inset-y-0 w-0.5"
            style={{
              left: `calc(${fillPct}% - 1px)`,
              background: glow,
              boxShadow: `0 0 10px 2px ${glow}`,
            }}
          />
        ) : null}
        {points.slice(1, -1).map((point) => (
          <div
            key={point.kind}
            aria-hidden
            className="absolute inset-y-0 border-l border-dashed border-warning/60"
            style={{ left: `${clamp01((point.date.getTime() - t0) / span) * 100}%` }}
          />
        ))}
      </div>

      {/* Wide: labels are absolutely positioned at their node's own offset,
          so a label always sits under the tick it names. The first and last
          are pinned to the edges rather than centred on their node, which
          would hang them half off the track. */}
      <div className="relative hidden h-4 md:block">
        {points.map((point, index) => {
          const pct = clamp01((point.date.getTime() - t0) / span) * 100;
          const isFirst = index === 0;
          const isLast = index === points.length - 1;
          return (
            <div
              key={point.kind}
              className={cn("absolute top-0 whitespace-nowrap", isLast && "right-0")}
              style={
                isFirst
                  ? { left: 0 }
                  : isLast
                    ? undefined
                    : { left: `${pct}%`, transform: "translateX(-50%)" }
              }
            >
              <NodeLabel point={point} now={now} />
            </div>
          );
        })}
      </div>

      {/* Narrow: three labels can't share a phone's width without colliding,
          so they stack. The track above still carries the proportions. */}
      <div className="flex flex-col gap-1 md:hidden">
        {points.map((point) => (
          <NodeLabel key={point.kind} point={point} now={now} />
        ))}
      </div>
    </div>
  );
}

function NodeLabel({
  point,
  now,
}: {
  point: ReturnType<typeof lifecyclePoints>[number];
  now: Date;
}) {
  const passed = point.date.getTime() <= now.getTime();
  return (
    <span
      className={cn(
        "flex items-baseline gap-1 tracking-widest",
        SUPPORTING_TEXT,
        // Past milestones read as fact, future ones as schedule — the same
        // contrast rule the board's `LifecycleDates` uses.
        passed ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span aria-hidden className={GLYPH_TINT[point.kind]}>
        {MILESTONE_GLYPH[point.kind]}
      </span>
      <span className="font-semibold">{point.label}</span>
      <span className="tabular-nums">
        {point.date
          .toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            // Jam dates are UTC everywhere in this app.
            timeZone: "UTC",
          })
          .toUpperCase()}
      </span>
    </span>
  );
}
