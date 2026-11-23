import type { StoryFact } from "./story.ts";
import { num, plural } from "./units.ts";

/**
 * How emergence reads (GDD 13): what each kind of promotion is called, the
 * four templates play itself casts, and what a season's close keeps, fades
 * and adds. Like the chronicle, nothing here names a character.
 */

/** GDD 13.5's eight promotion types, in the dashboard's order. */
export const PROMOTION_TYPES = [
  "road",
  "camp",
  "haunt",
  "route",
  "style",
  "variant",
  "legend",
  "custom",
] as const;

/** Each type's noun, one and many; the last three are recorded the same way but are not GDD 13.5's. */
const TYPE_NOUNS: Record<string, [string, string]> = {
  road: ["road", "roads"],
  camp: ["camp", "camps"],
  haunt: ["haunt", "haunts"],
  route: ["route", "routes"],
  style: ["style", "styles"],
  variant: ["variant", "variants"],
  legend: ["legend", "legends"],
  custom: ["custom", "customs"],
  material: ["material", "materials"],
  class: ["class", "classes"],
  masters: ["bench of masters", "benches of masters"],
};

/** A type's noun: "road"; a type not known here as "promotion". */
export function promotionNoun(type: string): string {
  return TYPE_NOUNS[type]?.[0] ?? "promotion";
}

/** A count of one type: "1 road", "3 customs". */
export function promotionCount(type: string, n: number): string {
  const [one, many] = TYPE_NOUNS[type] ?? ["promotion", "promotions"];
  return plural(n, one, many);
}

function list(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** Counts by type in a fixed order, the zeros left out: "2 roads, 1 camp and 1 style". */
export function promotionCounts(counts: Record<string, number>): string {
  const order = [...Object.keys(TYPE_NOUNS), ...Object.keys(counts).sort()];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of order) {
    if (seen.has(t)) continue;
    seen.add(t);
    const n = counts[t] ?? 0;
    if (n > 0) out.push(promotionCount(t, n));
  }
  return list(out);
}

/** What an arc template is, where it came from, and what its lapse does. */
export interface ArcWords {
  about: string;
  origin: string;
  lapse: string;
}

/** What a side asks for and what winning it does. */
export interface SideWords {
  asks: string;
  won: string;
}

const ARCS: Record<string, ArcWords> = {
  "the-road-war": {
    about:
      "A road this busy draws a raider. Patrol it and it runs safer; prey on it and it is cut.",
    origin: "It came from a busy road, with a faction that does not hold it close by.",
    lapse: "Left alone, the region's roads are tolled: every crossing costs coin for a while.",
  },
  "the-lost-caravan": {
    about:
      "A caravan stopped short of a dangerous region. Rescue it and it goes on; salvage it and its goods are shared out.",
    origin: "It came from a trade route's caravan whose road ahead crosses a region under threat.",
    lapse: "Left alone, the caravan is lost, and its goods lie where it stopped.",
  },
  "the-rival-claims": {
    about:
      "Two settlements race for the same thing. Back a claim with goods; the claim that wins brings its place prosperity.",
    origin:
      "It came from two goals: posted on different boards, racing for the same thing in one region.",
    lapse: "Left alone, the region grows restless.",
  },
  "the-legend-wakes": {
    about:
      "A legend stirs. Hunt it down to lay it to rest, or ward the nearest place to hold it off.",
    origin: "It came from a legend play made, stirring near an open place.",
    lapse: "Left alone, the region's threat rises.",
  },
};

const STAGES: Record<string, string> = {
  "the-raids": "Raiders ride for the road.",
  "the-stranded": "The caravan waits where it stopped, and the road ahead is not safe.",
  "the-claims": "Both claims are open: the first to meet its mark takes it.",
  "the-waking": "The legend is awake and on the move.",
};

const SIDES: Record<string, SideWords> = {
  "patrol-it": {
    asks: "beats won along the road",
    won: "the road is patrolled for a while, safer to travel, and threat there falls",
  },
  "prey-on-it": {
    asks: "goods delivered to the raider",
    won: "the road is cut for a while, and the raider fortifies",
  },
  "rescue-it": {
    asks: "someone reaching the caravan",
    won: "the caravan goes on its way, and threat in the region ahead falls",
  },
  "salvage-it": {
    asks: "beats won in the region ahead",
    won: "the caravan's goods are shared among this side's backers, by what each put in",
  },
  "back-a": {
    asks: "goods delivered to the first claim's settlement",
    won: "that settlement prospers, and its holder's standing rises",
  },
  "back-b": {
    asks: "goods delivered to the second claim's settlement",
    won: "that settlement prospers, and its holder's standing rises",
  },
  "hunt-it": {
    asks: "beats won in the legend's region",
    won: "the legend is laid to rest, and threat there falls",
  },
  "ward-it": {
    asks: "provisions delivered to the nearest place",
    won: "threat in the legend's region falls",
  },
};

/** Side names where an id alone reads badly; a pack's own name still wins. */
export const SIDE_NAMES: Record<string, string> = {
  "back-a": "Back the first claim",
  "back-b": "Back the second claim",
};

/** A rival claim's side named by its seat: "Back Ashford's claim". */
export function claimSideName(id: string, at: string): string | undefined {
  return SIDE_NAMES[id] && at ? `Back ${at}'s claim` : undefined;
}

/** What a template is, where it came from and what its lapse does; undefined for one without words here. */
export function arcWords(template: string): ArcWords | undefined {
  return ARCS[template];
}

/** A stage's one line, or "" for a stage without words here. */
export function stageWords(stage: string): string {
  return STAGES[stage] ?? "";
}

/** What a side asks and what winning it does; undefined for a side without words here. */
export function sideWords(side: string): SideWords | undefined {
  return SIDES[side];
}

/** The templates, stages and sides this file has words for. */
export function emergenceWords(): { arcs: string[]; stages: string[]; sides: string[] } {
  return { arcs: Object.keys(ARCS), stages: Object.keys(STAGES), sides: Object.keys(SIDES) };
}

function datum(f: StoryFact | undefined, k: string): { n: number; s: string } {
  const d = f?.data.find((x) => x.k === k);
  return { n: d?.n ?? 0, s: d?.s ?? "" };
}

/** What season.added counts, as "1 style, 2 variants and 1 material", or "" for none. */
export function seasonAddedCounts(added: StoryFact): string {
  return promotionCounts({
    style: datum(added, "styles").n,
    variant: datum(added, "variants").n,
    material: datum(added, "materials").n,
    class: datum(added, "classes").n,
  });
}

/** What a season's close keeps (GDD 13.4). `kept` counts the season's promotions by type. */
export function seasonKept(kept: Record<string, number> = {}): string {
  const counts = promotionCounts(kept);
  return counts
    ? `Kept: everything play made part of the world, this season's ${counts} among it.`
    : "Kept: everything play made part of the world.";
}

/** What a season's close fades (GDD 13.4). */
export function seasonFaded(): string {
  return "Faded: every trace that never reached its line; crossings, clearings and wins start again from nothing.";
}

/** What a new season adds (GDD 12.6), from its season.added fact. */
export function seasonAdded(added?: StoryFact): string {
  const counts = added ? seasonAddedCounts(added) : "";
  if (!counts) return "Added: nothing new to use this time.";
  const first = datum(added, "first").s;
  return `Added: ${counts}${first ? `, ${first} among them` : ""}.`;
}

/**
 * A season's close as one text: "Season 1 closed. Kept: … Faded: …
 * Added: …". `added` is the season.added the next season opens with.
 */
export function seasonTurnLine(o: {
  season: number;
  kept?: Record<string, number>;
  added?: StoryFact;
}): string {
  return [
    `Season ${num(o.season)} closed.`,
    seasonKept(o.kept),
    seasonFaded(),
    seasonAdded(o.added),
  ].join(" ");
}
