import type * as React from "react";

import { guildRankOf, isStaffRank } from "@/lib/guild-rank";

/**
 * A booster's chosen name glow: one to three colours, swept across the name
 * as a rotating gradient. Stops are equidistant by construction — the member
 * picks colours, never positions — so only the list is stored.
 *
 * Colours are painted exactly as picked. Nothing is pulled towards legibility:
 * a name that vanishes into a theme is the member's call to make.
 *
 * A stop is `#rrggbb`, or `oklch(L% C H)` for a colour sRGB can't hold — a
 * wide-gamut screen shows those in full, and the browser maps them to the
 * nearest colour anywhere else.
 */

const HEX_RGB = /^#([0-9a-f]{6})$/i;
const OKLCH = /^oklch\(\s*(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\)$/i;

/** Enough for a gradient with a middle, few enough to stay a name. */
export const MAX_GLOW_STOPS = 3;

/**
 * One stop in its stored form: lowercase `#rrggbb`, or `oklch(L% C H)` with
 * L at one decimal, C at three and H at one — the notation the picker writes.
 * Anything else, including the shorthand and alpha hex forms `safeThemeColor`
 * tolerates, is rejected: this value reaches an inline style, so only these
 * two exact shapes get through.
 */
export function normalizeGlowColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  const hex = HEX_RGB.exec(trimmed);
  if (hex) return `#${hex[1].toLowerCase()}`;

  const oklch = OKLCH.exec(trimmed);
  if (!oklch) return null;
  const [l, c, h] = oklch.slice(1).map(Number);
  if (l > 100) return null;
  const fixed = (v: number, places: number) => Number(v.toFixed(places));
  return `oklch(${fixed(l, 1)}% ${fixed(c, 3)} ${fixed(h % 360, 1)})`;
}

/**
 * A whole stop list as it should be stored: every entry a real colour, at
 * most `MAX_GLOW_STOPS` of them, and an empty result reported as null so
 * "no glow" has one representation rather than two.
 */
export function normalizeGlowColors(raw: readonly string[] | null | undefined): string[] | null {
  if (!raw?.length) return null;
  const stops = raw
    .slice(0, MAX_GLOW_STOPS)
    .map(normalizeGlowColor)
    .filter((stop): stop is string => stop != null);
  return stops.length > 0 ? stops : null;
}

export type NameGlowEntitlement = {
  /** Projected as a boolean, not the boost timestamp: every byline carries
   *  this, and whether someone boosts is all a name treatment needs to know. */
  isBooster: boolean;
  /** Resolved role names, the same list the rank chip reads. */
  guildRoles?: string[] | null;
};

export type NameGlowFields = NameGlowEntitlement & {
  nameGlowColors: string[] | null;
};

/**
 * Who may wear a glow: anyone boosting the guild, anyone holding a staff
 * rank (`isStaffRank` — Brackeys Team, dev, admin, mod, staff), and BIPs.
 * Guru stays outside it. BIP is matched on the role list rather than the
 * resolved rank, since a BIP who is also a Guru resolves to the higher rank.
 *
 * Staff eligibility is read off the same role names the chip uses rather than
 * an authorization call: this decides whether a name is tinted, and nothing
 * more, so it must never become a gate anything else trusts.
 */
export function canUseNameGlow(fields: NameGlowEntitlement): boolean {
  if (fields.isBooster) return true;
  const rank = guildRankOf(fields.guildRoles);
  if (rank != null && isStaffRank(rank)) return true;
  return fields.guildRoles?.includes("BIP") ?? false;
}

/**
 * The stops a profile should render, or null. Entitlement is
 * re-checked here rather than cleared on write: someone who stops boosting or
 * steps down keeps their colours, so they come back if they return.
 */
export function resolveNameGlow(fields: NameGlowFields): string[] | null {
  if (!canUseNameGlow(fields)) return null;
  return normalizeGlowColors(fields.nameGlowColors);
}

/**
 * How the gradient moves. `still` is a plain gradient; the sweeps run it
 * along one axis; `rotate` turns the gradient angle; `radial` breathes it
 * out from the centre.
 */
export const NAME_GLOW_MOTIONS = [
  "rotate",
  "sweep-right",
  "sweep-left",
  "sweep-down",
  "sweep-up",
  "radial",
  "still",
] as const;

export type NameGlowMotion = (typeof NAME_GLOW_MOTIONS)[number];

/** What a member who picked colours before motion was a choice already has. */
export const DEFAULT_NAME_GLOW_MOTION: NameGlowMotion = "rotate";

export function normalizeGlowMotion(raw: string | null | undefined): NameGlowMotion {
  return NAME_GLOW_MOTIONS.includes(raw as NameGlowMotion)
    ? (raw as NameGlowMotion)
    : DEFAULT_NAME_GLOW_MOTION;
}

/**
 * A whole glow as one pasteable line: `glow:rotate:7f5af0,150b5e,1f0fbd`.
 * Hex stops drop their `#` — it's the only thing they can be once decoded —
 * and `oklch(…)` stops stay as written, so the line still reads as colours to
 * a person and survives a trip through Discord.
 */
export function encodeNameGlow(stops: readonly string[], motion: NameGlowMotion): string {
  return `glow:${motion}:${stops.map((stop) => stop.replace(/^#/, "")).join(",")}`;
}

/**
 * The inverse of `encodeNameGlow`, forgiving of what a paste does to it:
 * the `glow:` prefix and the motion are optional, `#` is allowed, and
 * whitespace around the separators is ignored. Anything it can't read in
 * full is null — a config applies whole or not at all.
 */
export function decodeNameGlow(
  raw: string,
): { stops: string[]; motion: NameGlowMotion | null } | null {
  const parts = raw
    .trim()
    .replace(/^glow\s*:/i, "")
    .split(":")
    .map((part) => part.trim());
  if (parts.length > 2) return null;

  const [motionPart, stopsPart] = parts.length === 2 ? parts : [null, parts[0]];
  const motion = motionPart ? (motionPart.toLowerCase() as NameGlowMotion) : null;
  if (motion && !NAME_GLOW_MOTIONS.includes(motion)) return null;

  const raws = stopsPart.split(",").map((stop) => stop.trim());
  if (raws.length === 0 || raws.length > MAX_GLOW_STOPS) return null;
  const stops = raws.map((stop) =>
    normalizeGlowColor(/^[0-9a-f]{6}$/i.test(stop) ? `#${stop}` : stop),
  );
  if (stops.some((stop) => stop == null)) return null;
  return { stops: stops as string[], motion };
}

export const NAME_GLOW_MOTION_LABELS: Record<NameGlowMotion, string> = {
  rotate: "Rotate",
  "sweep-right": "Right",
  "sweep-left": "Left",
  "sweep-down": "Down",
  "sweep-up": "Up",
  radial: "Radial",
  still: "Still",
};

/**
 * The gradient and the animation for a motion. Only the keyframes live in
 * CSS — the animation *name* and direction ride inline, so a new motion is
 * a case here rather than another class in the stylesheet.
 */
function motionStyle(motion: NameGlowMotion): React.CSSProperties {
  const stops = "var(--name-glow-stops)";
  switch (motion) {
    case "still":
      return { backgroundImage: `linear-gradient(90deg, ${stops})` };
    case "rotate":
      return {
        backgroundImage: `linear-gradient(var(--name-glow-angle), ${stops})`,
        animationName: "name-glow-rotate",
      };
    case "sweep-right":
    case "sweep-left":
      return {
        backgroundImage: `linear-gradient(90deg, ${stops})`,
        backgroundSize: "200% auto",
        animationName: "name-glow-sweep",
        animationDirection: motion === "sweep-left" ? "reverse" : undefined,
      };
    case "sweep-down":
    case "sweep-up":
      return {
        backgroundImage: `linear-gradient(180deg, ${stops})`,
        backgroundSize: "auto 200%",
        animationName: "name-glow-sweep-y",
        animationDirection: motion === "sweep-up" ? "reverse" : undefined,
      };
    case "radial":
      return {
        backgroundImage: `radial-gradient(circle at 50% 50%, ${stops})`,
        backgroundPosition: "center",
        animationName: "name-glow-radial",
        animationDirection: "alternate",
        animationTimingFunction: "ease-in-out",
      };
  }
}

/**
 * What a glowing name renders with. Spread the style, and merge the class
 * through `cn` so the surface keeps its own.
 *
 * A single stop is a flat colour — a gradient needs two ends. Two or three
 * become a gradient that repeats its first colour at the far end, so the
 * sweep has no seam as it comes back round.
 *
 * Everything but the keyframes is inline: the name surfaces carry Tailwind
 * colour utilities, and only an inline `color` reliably beats them.
 */
export function nameGlowProps(
  stops: readonly string[] | null | undefined,
  /** The stored column, normalized here so no call site has to. */
  motion?: string | null,
): { className?: string; style?: React.CSSProperties } {
  if (!stops?.length) return {};
  if (stops.length === 1) {
    return { style: { color: stops[0], textShadow: halo(stops[0]) } };
  }

  return {
    className: "name-glow",
    style: {
      "--name-glow-stops": [...stops, stops[0]].join(", "),
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      color: "transparent",
      // `drop-shadow` rather than `text-shadow`: the glyph is a clipped
      // background, and a text-shadow would be cast by text that is painted
      // transparent. A filter reads the rendered alpha, so the halo takes the
      // shape of the letters the gradient is actually showing through.
      filter: stops
        .slice(0, 2)
        .map(
          (stop, index) => `drop-shadow(0 0 ${index === 0 ? "0.3em" : "0.6em"} ${haloTint(stop)})`,
        )
        .join(" "),
      ...motionStyle(normalizeGlowMotion(motion)),
    } as React.CSSProperties,
  };
}

/** The lit-from-within cast a single colour gets. */
function halo(stop: string): string {
  return `0 0 0.5em ${haloTint(stop)}`;
}

/** A stop at 35% — enough to read as a glow on a dark surface without
 *  smearing the letterforms. `color-mix` rather than a hex alpha suffix so
 *  an `oklch()` stop keeps its gamut. */
function haloTint(stop: string): string {
  return `color-mix(in oklab, ${stop} 35%, transparent)`;
}
