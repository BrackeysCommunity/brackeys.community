import { isBrackeysJam } from "@/components/jams/JamCalendarPage/board/build-board";
import {
  type JamFromList,
  type JamHeroPin,
  jamShelf,
} from "@/components/jams/JamCalendarPage/helpers";

export interface HeroJam {
  jam: JamFromList;
  /** How this jam won the slot — staff-facing; the panel renders all three alike. */
  source: "brackeys" | "pinned" | "ranked";
}

/** A pin applies only while its jam is still worth leading with. Past that
 *  the hero moves on by itself, so nothing has to be unpinned on time. */
export function heroPinApplies(jam: JamFromList, now: Date): boolean {
  const shelf = jamShelf(jam, now);
  return shelf === "live" || shelf === "upcoming";
}

/**
 * Which single jam the hero promotes, in priority order: newest live staff
 * pin, then Brackeys' own jam, then the top of the featured tier. A pin
 * deliberately outranks a Brackeys jam — `AdminHeroJam` surfaces that
 * displacement rather than blocking it. Pins match against the whole board,
 * since a hand-picked jam may be one the ranking never surfaced.
 */
export function pickHeroJam(
  featured: JamFromList[],
  all: JamFromList[] = featured,
  pins: JamHeroPin[] = [],
  now: Date = new Date(),
): HeroJam | null {
  const byId = new Map(all.map((jam) => [jam.jamId, jam]));
  // `listJamHeroPins` already orders newest first.
  for (const pin of pins) {
    const jam = byId.get(pin.jamId);
    if (jam && heroPinApplies(jam, now)) return { jam, source: "pinned" };
  }

  const brackeys = featured.find(isBrackeysJam);
  if (brackeys) return { jam: brackeys, source: "brackeys" };

  const first = featured[0];
  return first ? { jam: first, source: "ranked" } : null;
}

/** The Brackeys jam a pin is currently keeping off the hero, if any. The
 * admin panel warns with this — the front page shows no trace of it. */
export function heroJamDisplacedByPin(
  hero: HeroJam | null,
  all: JamFromList[],
  now: Date,
): JamFromList | null {
  if (hero?.source !== "pinned") return null;
  // Excluding the hero's own jam: pinning our own jam is not a displacement.
  return (
    all.find(
      (jam) => jam.jamId !== hero.jam.jamId && isBrackeysJam(jam) && heroPinApplies(jam, now),
    ) ?? null
  );
}
