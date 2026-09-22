import type * as React from "react";

import { guildRankOf, isStaffRank } from "@/lib/guild-rank";

/**
 * A booster's chosen name glow: one to three colours, swept across the name
 * as a rotating gradient. Stops are equidistant by construction — the member
 * picks colours, never positions — so only the list is stored.
 *
 * Boosters pick freely, so a pick is stored exactly as given and clamped here
 * at render. A free picker will otherwise produce names that vanish into one
 * theme or another, and the site ships fifteen of them plus light and dark.
 * The clamp is on lightness only: hue and saturation are the whole point of
 * letting someone choose, and lightness is the axis that decides whether the
 * name survives a near-white or near-black surface. Because nothing is
 * normalized on write, moving the band re-renders every existing pick with no
 * backfill.
 */

const HEX_RGB = /^#([0-9a-f]{6})$/i;

/** Enough for a gradient with a middle, few enough to stay a name. */
export const MAX_GLOW_STOPS = 3;

/** Below this a glow disappears into dark themes, above it into light ones. */
export const GLOW_MIN_LIGHTNESS = 0.45;
export const GLOW_MAX_LIGHTNESS = 0.72;

/** Strict `#rrggbb`, lowercased. Anything else — including the shorthand and
 *  alpha forms `safeThemeColor` tolerates — is rejected: this value reaches an
 *  inline style, and the clamp below needs six digits to do arithmetic on. */
export function normalizeGlowColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = HEX_RGB.exec(raw.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
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
    .filter((hex): hex is string => hex != null);
  return stops.length > 0 ? stops : null;
}

/** Hue in degrees, saturation and lightness as 0–1. */
export type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const channel = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * One colour as it should actually be painted: the member's hue and
 * saturation, with lightness pulled into the legible band. Null for anything
 * that isn't a `#rrggbb` string.
 */
export function clampGlowColor(raw: string | null | undefined): string | null {
  const hex = normalizeGlowColor(raw);
  if (!hex) return null;

  const hsl = hexToHsl(hex);
  const l = Math.min(GLOW_MAX_LIGHTNESS, Math.max(GLOW_MIN_LIGHTNESS, hsl.l));
  // Round-tripping an in-band colour through the conversions would drift it by
  // a digit for no reason, so an untouched lightness keeps the exact pick.
  return l === hsl.l ? hex : hslToHex({ ...hsl, l });
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
 * Who may wear a glow: anyone boosting the guild, and anyone holding a staff
 * rank. `isStaffRank` is the house definition — dev, admin, moderator, staff —
 * so the community ranks (Guru, BIP) are deliberately outside it.
 *
 * Staff eligibility is read off the same role names the chip uses rather than
 * an authorization call: this decides whether a name is tinted, and nothing
 * more, so it must never become a gate anything else trusts.
 */
export function canUseNameGlow(fields: NameGlowEntitlement): boolean {
  if (fields.isBooster) return true;
  const rank = guildRankOf(fields.guildRoles);
  return rank != null && isStaffRank(rank);
}

/**
 * The stops a profile should render, clamped, or null. Entitlement is
 * re-checked here rather than cleared on write: someone who stops boosting or
 * steps down keeps their colours, so they come back if they return.
 */
export function resolveNameGlow(fields: NameGlowFields): string[] | null {
  if (!canUseNameGlow(fields)) return null;
  const stops = normalizeGlowColors(fields.nameGlowColors);
  if (!stops) return null;
  return stops.map((hex) => clampGlowColor(hex)).filter((hex): hex is string => hex != null);
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
        .map((stop, index) => `drop-shadow(0 0 ${index === 0 ? "0.3em" : "0.6em"} ${stop}59)`)
        .join(" "),
      ...motionStyle(normalizeGlowMotion(motion)),
    } as React.CSSProperties,
  };
}

/** The lit-from-within cast a single colour gets. `59` is 35% alpha: enough
 *  to read as a glow on a dark surface without smearing the letterforms. */
function halo(stop: string): string {
  return `0 0 0.5em ${stop}59`;
}
