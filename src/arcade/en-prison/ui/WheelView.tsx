import { useMemo } from "react";

import { cn } from "@/lib/utils";

import type { WheelState } from "../sim/state.ts";
import { hasTrait, type Pocket } from "../sim/upgrades.ts";
import {
  ANGLE_UNITS,
  DEFLECTOR_COUNT,
  deflectorAngle,
  POCKET_COUNT,
  pocketColor,
  UNITS_PER_POCKET,
  WHEEL_ORDER,
} from "../sim/wheel.ts";
import { bandSlots, type BallFrame } from "./playback.ts";

/**
 * The wheel, drawn.
 *
 * SVG rather than the canvas `05` names. `07` calls wheel legibility its top
 * risk — thirty-seven pockets carrying marks, eight diamonds, fret types and
 * traps, on a phone — and the answer to that is per-pocket structure you can
 * inspect, theme and test, not pixels. The ball is the only thing that moves
 * every frame, and one transform is cheap.
 *
 * Angles come out of the sim in its own integer units, where a revolution is
 * `ANGLE_UNITS` and zero is the zero pocket. Degrees are computed here and
 * nowhere else, so the sim never needs a trig call.
 */

const SIZE = 320;
const CENTRE = SIZE / 2;
const RIM = 152;
const TRACK = 138;
const POCKET_OUTER = 124;
const POCKET_INNER = 88;
const HUB = 66;

function degrees(angle: number): number {
  return (angle / ANGLE_UNITS) * 360;
}

function point(angle: number, radius: number): [number, number] {
  const radians = ((degrees(angle) - 90) * Math.PI) / 180;
  return [CENTRE + radius * Math.cos(radians), CENTRE + radius * Math.sin(radians)];
}

/** The wedge for one pocket, as a path. */
function wedge(slot: number): string {
  const half = UNITS_PER_POCKET / 2;
  const centre = slot * UNITS_PER_POCKET;
  const [ax, ay] = point(centre - half, POCKET_OUTER);
  const [bx, by] = point(centre + half, POCKET_OUTER);
  const [cx, cy] = point(centre + half, POCKET_INNER);
  const [dx, dy] = point(centre - half, POCKET_INNER);
  return `M ${ax} ${ay} A ${POCKET_OUTER} ${POCKET_OUTER} 0 0 1 ${bx} ${by} L ${cx} ${cy} A ${POCKET_INNER} ${POCKET_INNER} 0 0 0 ${dx} ${dy} Z`;
}

const POCKET_FILL: Record<ReturnType<typeof pocketColor>, string> = {
  red: "var(--ep-red)",
  black: "var(--ep-black)",
  green: "var(--ep-green)",
};

/**
 * A pocket's marks, as the short glyph string drawn over it.
 *
 * `07` wants a built wheel to read at a glance, and at this size a legend is
 * not available — the mark has to carry the meaning itself. Gaff level is
 * the count of dots because a count reads faster than a numeral at 8px, and
 * each trait gets one letterform.
 */
const TRAIT_GLYPH = {
  spring: "↑",
  sticky: "●",
  magnet: "✲",
  hot: "▲",
  echo: "×",
  bank: "■",
  wild: "★",
  cold: "❄",
} as const;

export function pocketMarks(pocket: Pocket): string {
  const marks: string[] = [];
  if (pocket.gaff > 0) marks.push("•".repeat(pocket.gaff));
  for (const trait of Object.keys(TRAIT_GLYPH) as (keyof typeof TRAIT_GLYPH)[]) {
    if (hasTrait(pocket, trait)) marks.push(TRAIT_GLYPH[trait]);
  }
  return marks.join("");
}

export type WheelViewProps = {
  wheel: WheelState;
  /** Rotor rotation to draw at, in angle units. */
  rotorAngle?: number;
  /** The drop band to highlight, if the player is lining up a launch. */
  band?: { slot: number; halfWidth: number } | null;
  /** Where each ball is right now. */
  balls?: readonly BallFrame[];
  /** The number that just came up, held lit after a spin. */
  result?: number | null;
  className?: string;
};

export function WheelView({
  wheel,
  rotorAngle = 0,
  band = null,
  balls = [],
  result = null,
  className,
}: WheelViewProps) {
  const lit = useMemo(() => new Set(band ? bandSlots(band.slot, band.halfWidth) : []), [band]);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className={cn("h-auto w-full max-w-[min(88vw,26rem)] select-none", className)}
      role="img"
      aria-label={describeWheel(wheel, result)}
    >
      <circle cx={CENTRE} cy={CENTRE} r={RIM} fill="var(--ep-bowl)" />
      <circle
        cx={CENTRE}
        cy={CENTRE}
        r={TRACK}
        fill="none"
        stroke="var(--ep-track)"
        strokeWidth={6}
      />

      {/* The rotor: pockets, frets and marks all turn together. */}
      <g transform={`rotate(${degrees(rotorAngle)} ${CENTRE} ${CENTRE})`}>
        {WHEEL_ORDER.map((number, slot) => {
          const pocket = wheel.pockets[number]!;
          const marks = pocketMarks(pocket);
          const [lx, ly] = point(slot * UNITS_PER_POCKET, (POCKET_OUTER + POCKET_INNER) / 2);
          const [mx, my] = point(slot * UNITS_PER_POCKET, POCKET_INNER + 8);
          return (
            <g key={number} data-slot={slot} data-number={number}>
              <path
                d={wedge(slot)}
                fill={POCKET_FILL[pocketColor(number)]}
                stroke="var(--ep-fret)"
                strokeWidth={1}
              />
              {lit.has(slot) ? (
                <path d={wedge(slot)} fill="var(--ep-band)" className="pointer-events-none" />
              ) : null}
              {result === number ? (
                <path
                  d={wedge(slot)}
                  fill="none"
                  stroke="var(--ep-result)"
                  strokeWidth={3}
                  className="pointer-events-none"
                />
              ) : null}
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={9}
                fill="var(--ep-ink)"
                transform={`rotate(${degrees(slot * UNITS_PER_POCKET)} ${lx} ${ly})`}
              >
                {number}
              </text>
              {marks ? (
                <text
                  x={mx}
                  y={my}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={7}
                  fill="var(--ep-mark)"
                  transform={`rotate(${degrees(slot * UNITS_PER_POCKET)} ${mx} ${my})`}
                >
                  {marks}
                </text>
              ) : null}
            </g>
          );
        })}
        <circle cx={CENTRE} cy={CENTRE} r={HUB} fill="var(--ep-hub)" />
      </g>

      {/* The diamonds are bolted to the bowl, so they do not turn. */}
      {Array.from({ length: DEFLECTOR_COUNT }, (_, i) => {
        const deflector = wheel.deflectors[i]!;
        const [x, y] = point(deflectorAngle(i), TRACK - 12);
        return (
          <rect
            key={i}
            x={x - 4}
            y={y - 4}
            width={8}
            height={8}
            transform={`rotate(45 ${x} ${y})`}
            fill={deflector.kind === "plain" ? "var(--ep-diamond)" : "var(--ep-diamond-live)"}
            data-deflector={deflector.kind}
          />
        );
      })}

      {balls.map((ball) => {
        const radius = POCKET_INNER + 18 + ball.radius * (TRACK - POCKET_INNER - 14);
        const angle =
          ball.phase === "settled" || ball.phase === "scatter"
            ? ball.angle + rotorAngle
            : ball.angle;
        const [x, y] = point(angle, radius);
        return (
          <circle
            key={ball.ballId}
            cx={x}
            cy={y}
            r={5}
            fill="var(--ep-ball)"
            stroke="var(--ep-bowl)"
            strokeWidth={1}
            data-ball={ball.ballId}
            data-phase={ball.phase}
          />
        );
      })}
    </svg>
  );
}

/**
 * The wheel in words.
 *
 * `07` lists "a plain-text wheel summary" among the things its legibility
 * risk probably needs. It is the accessible name here, so the screen-reader
 * path and the fallback for a player who cannot read the marks are the same
 * string rather than two that drift.
 */
export function describeWheel(wheel: WheelState, result: number | null = null): string {
  const built = wheel.pockets
    .map((pocket, number) => ({ pocket, number }))
    .filter(({ pocket }) => pocket.gaff > 0 || pocket.traits.length > 0)
    .map(({ pocket, number }) => {
      const parts: string[] = [];
      if (pocket.gaff > 0) parts.push(`x${pocket.gaff + 1}`);
      parts.push(...pocket.traits);
      return `${number} ${parts.join(" ")}`;
    });

  const head = `European wheel, ${POCKET_COUNT} pockets.`;
  const marks = built.length ? ` Upgraded: ${built.join(", ")}.` : " No upgraded pockets.";
  const landed = result === null ? "" : ` Last number ${result}.`;
  return head + marks + landed;
}
