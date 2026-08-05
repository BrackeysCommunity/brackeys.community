/**
 * The jam shape the banner surfaces read. Narrower than `JamFromList` on
 * purpose: these render from the board payload, from the home carousel's
 * featured tier, and from the hero panel, and none of them should acquire
 * a dependency on columns they don't draw.
 */
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

/** `compact` is the touch/mobile scale; `comfortable` is the desktop one. */
export type Density = "compact" | "comfortable";

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
