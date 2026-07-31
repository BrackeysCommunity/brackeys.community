import { cn } from "@/lib/utils";

/**
 * Pastel two-stop gradient colorways used for banner art across the
 * profile page (hero strip, project card banners, avatar fallback).
 * Fixed hexes rather than theme tokens — these are "cover art", the
 * same way itch.io capsule placeholders stay saturated regardless of
 * the site theme, so they read identically across all color themes.
 */
const BANNER_COLORWAYS = [
  { from: "#e79fc4", to: "#b7a5ea" }, // pink → lavender
  { from: "#9db2eb", to: "#b299e7" }, // periwinkle → violet
  { from: "#efa07f", to: "#e87d96" }, // coral → rose
  { from: "#8fd6a0", to: "#7cceca" }, // mint → teal
  { from: "#eeb083", to: "#e98d9d" }, // peach → blush
  { from: "#d898df", to: "#a591ee" }, // orchid → purple
] as const;

export interface BannerColorway {
  from: string;
  to: string;
}

/** Deterministically pick a colorway for a stable key (project id,
 * user handle) so the same entity always renders the same gradient
 * while a grid of many reads as varied. */
export function colorwayForKey(key: string): BannerColorway {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return BANNER_COLORWAYS[h % BANNER_COLORWAYS.length] ?? BANNER_COLORWAYS[0]!;
}

/** Hatched diagonal stripes — the project-card treatment. */
const DIAGONAL_STRIPES =
  "repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 3px, transparent 3px 10px)";

/** Fine vertical scanlines — the hero-strip treatment. */
const VERTICAL_STRIPES =
  "repeating-linear-gradient(90deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 7px)";

interface GradientBannerProps {
  /** Stable key that picks the colorway (project id / handle). */
  seed: string;
  pattern?: "diagonal" | "vertical";
  className?: string;
  children?: React.ReactNode;
}

/**
 * Striped pastel gradient banner. The screenshot-reference "cover
 * art" treatment: a soft two-stop gradient with a translucent stripe
 * overlay, deterministic per seed. Children render above the art
 * (overlaid titles, chips).
 */
export function GradientBanner({
  seed,
  pattern = "diagonal",
  className,
  children,
}: GradientBannerProps) {
  const { from, to } = colorwayForKey(seed);
  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ backgroundImage: `linear-gradient(120deg, ${from}, ${to})` }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: pattern === "vertical" ? VERTICAL_STRIPES : DIAGONAL_STRIPES,
        }}
      />
      {/* Slight darkening at the base so overlaid light text keeps
          contrast on the palest colorways. */}
      <div aria-hidden className="absolute inset-0 bg-black/5" />
      {children}
    </div>
  );
}
