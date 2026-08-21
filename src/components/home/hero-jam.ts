import { isBrackeysJam } from "@/components/jams/JamCalendarPage/board/build-board";
import {
  type JamFromList,
  type JamHeroPin,
  jamShelf,
} from "@/components/jams/JamCalendarPage/helpers";

export interface HeroJam {
  jam: JamFromList;
  /** How this jam earned its slide — staff-facing; the panel renders all three alike. */
  source: "brackeys" | "pinned" | "ranked";
}

/** The hero rotation carries at most this many slides. Keep
 * `RECENT_ENTRIES_MAX_JAMS` in `@/orpc/router/jam` at
 * `SHOWCASE_MAX_JAMS + HERO_SLIDE_MAX` or the covers request 400s. */
export const HERO_SLIDE_MAX = 4;

/** A pin applies only while its jam is still worth leading with. Past that
 *  the rotation moves on by itself, so nothing has to be unpinned on time. */
export function heroPinApplies(jam: JamFromList, now: Date): boolean {
  const shelf = jamShelf(jam, now);
  return shelf === "live" || shelf === "upcoming";
}

/**
 * The jams the hero rotates through, in priority order: Brackeys' own jam
 * whenever one is live or upcoming, then live staff picks newest first.
 * Staff picks join the rotation behind a Brackeys jam rather than
 * displacing it. The featured tier's top jam is a fallback for when
 * nothing is curated at all, never an extra slide. Pins match against the
 * whole board, since a hand-picked jam may be one the ranking never
 * surfaced.
 */
export function heroJamSlides(
  featured: JamFromList[],
  all: JamFromList[] = featured,
  pins: JamHeroPin[] = [],
  now: Date = new Date(),
): HeroJam[] {
  const slides: HeroJam[] = [];
  const seen = new Set<number>();
  const add = (jam: JamFromList, source: HeroJam["source"]) => {
    if (seen.has(jam.jamId)) return;
    seen.add(jam.jamId);
    slides.push({ jam, source });
  };

  const brackeys = featured.find((jam) => isBrackeysJam(jam) && heroPinApplies(jam, now));
  if (brackeys) add(brackeys, "brackeys");

  const byId = new Map(all.map((jam) => [jam.jamId, jam]));
  // `listJamHeroPins` already orders newest first.
  for (const pin of pins) {
    if (slides.length >= HERO_SLIDE_MAX) break;
    const jam = byId.get(pin.jamId);
    if (jam && heroPinApplies(jam, now)) add(jam, "pinned");
  }

  if (slides.length === 0) {
    const first = featured[0];
    if (first) add(first, "ranked");
  }

  return slides;
}

/** The single jam surfaces without a rotation lead with — the front of
 * `heroJamSlides`. */
export function pickHeroJam(
  featured: JamFromList[],
  all: JamFromList[] = featured,
  pins: JamHeroPin[] = [],
  now: Date = new Date(),
): HeroJam | null {
  return heroJamSlides(featured, all, pins, now)[0] ?? null;
}
