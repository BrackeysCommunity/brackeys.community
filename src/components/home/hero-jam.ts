import { isBrackeysJam } from "@/components/jams/JamCalendarPage/board/build-board";
import {
  type JamFromList,
  type JamHeroPin,
  jamShelf,
} from "@/components/jams/JamCalendarPage/helpers";
import { DAY_MS } from "@/lib/format-time";

export interface HeroJam {
  jam: JamFromList;
  /** How this jam earned its slide — staff-facing; the panel renders all three alike. */
  source: "brackeys" | "pinned" | "ranked";
}

/** The hero rotation carries at most this many slides. Keep
 * `RECENT_ENTRIES_MAX_JAMS` in `@/orpc/router/jam` at
 * `SHOWCASE_MAX_JAMS + HERO_SLIDE_MAX` or the covers request 400s. */
export const HERO_SLIDE_MAX = 4;

/** A pin keeps fronting the hero for this long after its jam ends, so a
 *  wrap-up can still lead — e.g. results, a highlight reel, a thank-you. */
const RECENTLY_ENDED_DAYS = 30;

/** A pin applies while its jam is live or upcoming, or ended within
 *  `RECENTLY_ENDED_DAYS`. Past that the rotation moves on by itself, so
 *  nothing has to be unpinned on time. */
export function heroPinApplies(jam: JamFromList, now: Date): boolean {
  const shelf = jamShelf(jam, now);
  if (shelf === "live" || shelf === "upcoming") return true;
  if (!jam.endsAt) return false;
  const endedMsAgo = now.getTime() - new Date(jam.endsAt).getTime();
  return endedMsAgo >= 0 && endedMsAgo <= RECENTLY_ENDED_DAYS * DAY_MS;
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
