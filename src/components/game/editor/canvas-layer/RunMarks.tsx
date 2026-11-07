import type { Pt } from "@jams/engine/editor";
import type { OverlayPoint, SceneOverlay } from "@jams/engine/scene";

import { num, polylinePath, toScreen, type View } from "./view";

const EVENT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];
const EVENT_PX = 4;
const OUTCOME_PX = 10;
/** Outcomes drawn as a success; anything else is a failure. */
const WON = new Set(["won", "win", "goal", "complete"]);

const toPt = (p: OverlayPoint): Pt => (Array.isArray(p) ? p : [p.x, p.y]);

/** A loaded run over the scene: its trail, a dot per event coloured by type, and where it ended. */
export function RunMarks({
  overlay,
  view,
  transform,
}: {
  overlay: SceneOverlay;
  view: View;
  /** The world group's transform. */
  transform: string;
}) {
  const trail = overlay.trail ? ("pts" in overlay.trail ? overlay.trail.pts : overlay.trail) : [];
  const types = [...new Set((overlay.events ?? []).map((e) => e.type))].sort();
  const colorOf = (type: string) => EVENT_COLORS[types.indexOf(type) % EVENT_COLORS.length]!;
  const outcome = overlay.outcome?.at ? toScreen(view, toPt(overlay.outcome.at)) : null;
  const won = WON.has(overlay.outcome?.result ?? "");

  return (
    <g data-run="">
      {trail.length > 1 ? (
        <g transform={transform}>
          <path
            data-run-trail=""
            d={polylinePath(trail)}
            fill="none"
            stroke="white"
            strokeOpacity={0.85}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ) : null}
      {trail.length > 0 ? (
        <circle
          data-run-start=""
          cx={num(toScreen(view, trail[0]!)[0])}
          cy={num(toScreen(view, trail[0]!)[1])}
          r={EVENT_PX + 1}
          fill="var(--success)"
          stroke="black"
          strokeWidth={1}
        />
      ) : null}
      {(overlay.events ?? []).map((e, i) => {
        const [x, y] = toScreen(view, toPt(e.at));
        return (
          <circle
            key={i}
            data-run-event={e.type}
            cx={num(x)}
            cy={num(y)}
            r={EVENT_PX}
            fill={colorOf(e.type)}
            stroke="black"
            strokeWidth={1}
          />
        );
      })}
      {outcome && overlay.outcome ? (
        <g data-run-outcome={overlay.outcome.result}>
          <circle
            cx={num(outcome[0])}
            cy={num(outcome[1])}
            r={OUTCOME_PX}
            fill="none"
            stroke={won ? "var(--success)" : "var(--destructive)"}
            strokeWidth={2.5}
          />
          <text
            x={num(outcome[0] + OUTCOME_PX + 4)}
            y={num(outcome[1] - OUTCOME_PX)}
            fontSize={11}
            fontWeight={600}
            fill={won ? "var(--success)" : "var(--destructive)"}
            stroke="black"
            strokeOpacity={0.7}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {overlay.outcome.cause
              ? `${overlay.outcome.result} · ${overlay.outcome.cause}`
              : overlay.outcome.result}
          </text>
        </g>
      ) : null}
    </g>
  );
}
