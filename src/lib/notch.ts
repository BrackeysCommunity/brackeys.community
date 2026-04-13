// ── Legacy exports (used by NotchedCard) ────────────────────────────

export const NOTCH_SIZE = 22;

export const notchClip = `polygon(
  0 0,
  calc(100% - ${NOTCH_SIZE}px) 0,
  100% ${NOTCH_SIZE}px,
  100% 100%,
  ${NOTCH_SIZE}px 100%,
  0 calc(100% - ${NOTCH_SIZE}px)
)`;

export const notchClipInner = `polygon(
  0 0,
  calc(100% - ${NOTCH_SIZE - 2}px) 0,
  100% ${NOTCH_SIZE - 2}px,
  100% 100%,
  ${NOTCH_SIZE - 2}px 100%,
  0 calc(100% - ${NOTCH_SIZE - 2}px)
)`;

// ── New notch system ────────────────────────────────────────────────

export type NotchCorner = "tl" | "tr" | "bl" | "br";

export interface NotchOpts {
  /** Cut size in pixels. Default: 6 */
  size?: number;
  /** Which corners to notch. Default: ['tr', 'bl'] */
  corners?: NotchCorner[];
}

const DEFAULTS = {
  size: 6,
  corners: ["tr", "bl"] as NotchCorner[],
} as const;

export function resolveNotchOpts(opts: NotchOpts | true): Required<NotchOpts> {
  if (opts === true) return { size: DEFAULTS.size, corners: [...DEFAULTS.corners] };
  return {
    size: opts.size ?? DEFAULTS.size,
    corners: opts.corners ?? [...DEFAULTS.corners],
  };
}

/**
 * Build a clip-path polygon for a notched rectangle.
 *
 * @param opts  - which corners to cut and how large
 * @param inset - shrink the polygon inward by this many px (for border frames)
 */
export function buildNotchPath(opts: NotchOpts | true, inset = 0): string {
  const { size, corners } = resolveNotchOpts(opts);
  const has = new Set(corners);
  const s = size;
  const i = inset;

  // Clockwise from top-left
  const pts: string[] = [];

  // Top-left
  if (has.has("tl")) {
    pts.push(`${s}px ${i}px`);
  } else {
    pts.push(`${i}px ${i}px`);
  }

  // Top-right
  if (has.has("tr")) {
    pts.push(`calc(100% - ${s}px) ${i}px`);
    pts.push(`calc(100% - ${i}px) ${s}px`);
  } else {
    pts.push(`calc(100% - ${i}px) ${i}px`);
  }

  // Bottom-right
  if (has.has("br")) {
    pts.push(`calc(100% - ${i}px) calc(100% - ${s}px)`);
    pts.push(`calc(100% - ${s}px) calc(100% - ${i}px)`);
  } else {
    pts.push(`calc(100% - ${i}px) calc(100% - ${i}px)`);
  }

  // Bottom-left
  if (has.has("bl")) {
    pts.push(`${s}px calc(100% - ${i}px)`);
    pts.push(`${i}px calc(100% - ${s}px)`);
  } else {
    pts.push(`${i}px calc(100% - ${i}px)`);
  }

  // Close: back to top-left via left edge
  if (has.has("tl")) {
    pts.push(`${i}px ${s}px`);
  }

  return `polygon(${pts.join(", ")})`;
}

/**
 * Filter a set of notch corners to only those on a given side.
 * Useful for button groups where only end items are notched.
 */
export function filterCorners(
  corners: NotchCorner[],
  side: "left" | "right" | "top" | "bottom",
): NotchCorner[] {
  const map: Record<string, NotchCorner[]> = {
    left: ["tl", "bl"],
    right: ["tr", "br"],
    top: ["tl", "tr"],
    bottom: ["bl", "br"],
  };
  const allowed = new Set(map[side]);
  return corners.filter((c) => allowed.has(c));
}
