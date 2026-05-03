export interface JamLike {
  jamId: number;
  slug: string;
  title: string;
  bannerUrl: string | null;
  hosts: { name: string; url: string }[];
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  entriesCount: number | null;
  joinedCount: number | null;
}

export type Density = "compact" | "comfortable";

export const ROTATE_MS = 6000;

export const SLIDE_DISTANCE = 60; // px
export const BODY_TRANSITION = { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const };
export const BANNER_TRANSITION = { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const };

// Swipe-to-navigate thresholds. Either a long-enough drag OR a fast-enough
// flick triggers a slide change.
export const SWIPE_OFFSET = 50; // px of drag distance
export const SWIPE_VELOCITY = 500; // px/s flick speed

// Variants are functions of `custom` (the slide direction). AnimatePresence
// forwards its `custom` to exiting children even after they've been removed
// from React's rendered children — so when the user reverses direction
// mid-flight, the outgoing slide reads the *latest* direction and exits in
// the same direction the new slide is entering.
export const slideVariants = {
  enter: (dir: 1 | -1) => ({ x: SLIDE_DISTANCE * dir, opacity: 0, scale: 1.15 }),
  center: { x: 0, opacity: 1, scale: 1 },
  exit: (dir: 1 | -1) => ({ x: -SLIDE_DISTANCE * dir, opacity: 0, scale: 1.15 }),
};

/** Pick two distinct random hex colors from `palette`. */
export function pickTwo(palette: string[]): [string, string] {
  if (palette.length === 0) return ["#444444", "#222222"];
  if (palette.length === 1) return [palette[0]!, palette[0]!];
  const i = Math.floor(Math.random() * palette.length);
  let j = Math.floor(Math.random() * palette.length);
  if (j === i) j = (j + 1) % palette.length;
  return [palette[i]!, palette[j]!];
}

/** Word-initials acronym fallback used as the "shortName" for jams without art. */
export function shortName(title: string) {
  const initials = title
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return initials.slice(0, 6) || title.slice(0, 5).toUpperCase();
}

export function jamUrl(slug: string) {
  return `https://itch.io/jam/${slug}`;
}
