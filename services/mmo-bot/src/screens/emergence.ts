import type { EmbedField } from "../../../../packages/discord-kit/src/index.ts";
import {
  bareNumbers,
  countWords,
  idWords,
  seasonAdded,
  UNITS,
} from "../../../../packages/mmo-words/src/index.ts";
import type * as api from "../api.ts";
import { WhyAdapted } from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { capitalise, type Lexicon, readable } from "../lexicon.ts";
import { amount, num, plural } from "../units.ts";
import { factNum, factStr } from "./common.ts";
import { artPicture } from "./staged.ts";
import { CHRONICLE_CHANNEL } from "./story.ts";

/**
 * What play made part of the world (GDD 13.2, 17.6): a card for each
 * promotion as the chronicle channel posts it, a legend laid, a custom
 * held and what a season added.
 * A promotion card never names a character, its first included: places,
 * creatures, materials and counts only.
 */

/** The name input of every own-name modal. */
export const NAME_INPUT = "name";
/** The longest name a kind or promotion takes: the board's title length. */
export const NAME_MOST = 60;

/** A tag as a card writes it: the setting's trait name, else the id in words. */
export function tagName(tag: string, lex: Lexicon): string {
  return (
    lex.names("items.traits", tag) ? lex.name("items.traits", tag) : readable(tag)
  ).toLowerCase();
}

/**
 * A found material by name. Before its first is looted the lexicon may not
 * name it yet: it is then the new material made of its base.
 */
export function foundMaterial(id: string, lex: Lexicon): string {
  if (lex.names("items.materials", id)) return lex.material(id);
  const base = /^found\.[^.]+\.(.+)$/.exec(id)?.[1];
  return base ? `a new material made of ${lex.material(base).toLowerCase()}` : lex.material(id);
}

/** The road, toll and cut a tile is on, in one line; "" off a road. */
export function roadLine(t: Pick<api.Tile, "roadName" | "cut" | "toll">, lex: Lexicon): string {
  if (!t.roadName) return "";
  if (t.cut) return `${capitalise(t.roadName)}, cut: no faster than the land until it is mended`;
  if (t.toll)
    return `${capitalise(t.roadName)}, tolled: ${amount(t.toll, "coin")} a crossing, once a day`;
  return `${capitalise(t.roadName)}: ${plural(lex.numbers.roadEnterTicks, "tick")} a tile, whatever the land`;
}

/** The band steps a region's adaptation took off an option, in words. */
export function adaptedLine(steps: number): string {
  const n = Math.abs(Math.trunc(steps));
  return `the creatures here adapted against it: ${countWords(n, "band")} worse`;
}

/** The steps an option's why says adaptation took off it, 0 for none. */
export function adaptedSteps(w: api.Why): number {
  return w.parts.filter((p) => p.label === WhyAdapted).reduce((n, p) => n + Math.abs(p.value), 0);
}

/** What a promotion's record or its fact says it is. */
function promotionOf(ev: api.StoryEvent): api.Promotion {
  const f = ev.fact;
  return (
    ev.promotion ?? {
      id: factStr(f, "id"),
      type: factStr(f, "type"),
      name: factStr(f, "name"),
      of: factStr(f, "of") || undefined,
      resists: factStr(f, "resists") || undefined,
      material: factStr(f, "material") || undefined,
      day: 0,
    }
  );
}

/** The parts a promotion card draws, by type. */
interface Told {
  author: string;
  title: string;
  description: string;
  fields?: EmbedField[];
  footer: string;
}

const ROAD_TERMS = (lex: Lexicon) =>
  `A road tile takes ${plural(lex.numbers.roadEnterTicks, "tick")} whatever the land; factions can tax, patrol or raid it.`;

const RENAME_FOOTER =
  "Its first may rename it once, within a few days; the world keeps it either way.";

function told(p: api.Promotion, f: api.Fact, lex: Lexicon, place?: string): Told | null {
  const name = p.name || "it";
  const of = p.ofName || "";
  const resists = p.resists ? tagName(p.resists, lex) : "";
  switch (p.type) {
    case "road":
      return {
        author: "A road forms",
        title: `A road forms: ${name}`,
        description:
          factStr(f, "via") === "pattern"
            ? `A solved pattern laid it to the nearest settlement. ${ROAD_TERMS(lex)}`
            : `Enough characters walked this ground in a few days that it became a road. ${ROAD_TERMS(lex)}`,
        footer: "A road never fades: a raid only cuts it for a few days.",
      };
    case "camp":
      return {
        author: "A camp",
        title: `A camp: ${name}`,
        description: `Cleared often enough, ${of ? `the ${of.toLowerCase()}` : "the site"} gained a tier-${lex.numbers.campTier} station anyone may work at for a fee.`,
        footer: "A settlement chartered here later takes the camp's place.",
      };
    case "haunt":
      return {
        author: "A haunt",
        title: `A haunt: ${name}`,
        description: `So many went down at ${of ? `the ${of.toLowerCase()}` : "the site"} that it is haunted: scavengers lead what lives there now.`,
        footer: "What was found there stays as it was; the haunt lies over it.",
      };
    case "route":
      return {
        author: "A trade route",
        title: `A trade route: ${name}`,
        description:
          "So much was carried between the two that the road between them is a named route. Caravans run it, and raiders know it.",
        footer: "A caravan's goods are counted like anyone's: robbed, they lie where it fell.",
      };
    case "style":
      return {
        author: "A style is named",
        title: `A style is named: ${name}`,
        description: `Many won here leaning on ${of ? of.toLowerCase() : "one pairing"}, and it has a name now. The region's creatures start adapting against it.`,
        fields: resists
          ? [{ name: "Adapting against", value: `options that are ${resists}`, inline: true }]
          : [],
        footer: RENAME_FOOTER,
      };
    case "variant":
      return {
        author: "A variant appears",
        title: `A variant appears: ${name}`,
        description: `The ${of ? of.toLowerCase() : "creatures"} here adapted until a variant appeared. It drops a material that did not exist.`,
        fields: [
          ...(resists ? [{ name: "Resists", value: capitalise(resists), inline: true }] : []),
          ...(p.material
            ? [{ name: "Drops", value: capitalise(foundMaterial(p.material, lex)), inline: true }]
            : []),
        ],
        footer: RENAME_FOOTER,
      };
    case "material":
      return {
        author: "A new material",
        title: `A new material: ${name}`,
        description: `Looted first from a variant, it ${of ? `is made of ${of.toLowerCase()} and ` : ""}opens kinds nobody has made. It is priced, wanted and worked like any material.`,
        footer: RENAME_FOOTER,
      };
    case "legend": {
      const item = (p.of ?? factStr(f, "of")).startsWith("item:");
      return {
        author: item ? "An item becomes a legend" : "A bounty becomes a legend",
        title: item ? `An item becomes a legend: ${name}` : `A bounty becomes a legend: ${name}`,
        description: item
          ? "Named in heavy deeds all season, it carries a trait of its own now."
          : `Nobody met the bounty on ${of ? `the ${of.toLowerCase()}` : "it"} in a full season of tries. It has a name, a trait and a place in the world's stories now.`,
        footer: item
          ? RENAME_FOOTER
          : "A legend wakes in the director's stories; laid to rest, it stays in the chronicle.",
      };
    }
    case "custom":
      return {
        author: "A custom",
        title: `A custom: ${name}`,
        description: `${place ? `${place} renewed` : "A settlement renewed"} the same goal ${countWords(lex.numbers.customSeasons, "season")} running. Now the world posts it by itself each season, paid from its treasury.`,
        footer: "A treasury short of the reward skips that season.",
      };
    case "class":
      return {
        author: "A class is found",
        title: `A class is found: ${of || name}`,
        description:
          "Someone crossed what it asks before anyone else did. Its thresholds now show on everyone's classes card.",
        footer: "A class is earned by practice, never picked.",
      };
    case "masters":
      return {
        author: "Masters",
        title: capitalise(name),
        description: `Enough masters of the ${of ? of.toLowerCase() : "family"} live here that its tinker's bench offers those machines ${countWords(lex.numbers.mastersEase, "level")} easier.`,
        footer: "A title is kept for good once held.",
      };
    default:
      return null;
  }
}

/** The chronicle channel's card for one promotion event, or null for a kind it does not post. */
export function promotionCard(ev: api.StoryEvent, lex: Lexicon): Card | null {
  const f = ev.fact;
  const card = (t: Told, colour: number = COLOUR.signal): Card => ({
    context: CHRONICLE_CHANNEL,
    author: authorLine("Promotion", t.author),
    title: t.title.slice(0, 256),
    description: t.description,
    picture: "form",
    fields: t.fields,
    footer: t.footer,
    rows: [],
    colour,
  });
  switch (f.kind) {
    case "promotion": {
      const t = told(promotionOf(ev), f, lex, ev.place);
      return t ? card(t) : null;
    }
    case "legend.laid":
      return card(
        {
          author: "A legend laid to rest",
          title: `${capitalise(ev.promotion?.name || factStr(f, "name") || "A legend")} is laid to rest`,
          description:
            "Its stage was won: it is gone from the world's stories, and kept in the chronicle.",
          footer: "Everything promoted is kept, even what was laid.",
        },
        COLOUR.ash,
      );
    case "custom.held":
      return card({
        author: "A custom held",
        title: `${capitalise(ev.promotion?.name || factStr(f, "name") || "A custom")} is posted again`,
        description: `${ev.place ? `${ev.place} posts` : "Its settlement posts"} it on the board as every season, the reward from its treasury.`,
        footer: "A custom is a goal the world posts by itself.",
      });
    case "season.added":
      return seasonAddedCard(f);
    case "season.epoch":
      return epochNotesCard(ev, lex);
    default:
      return null;
  }
}

/** What the season just closed promoted that a player can use (GDD 12.6, 13.4). */
function seasonAddedCard(f: api.Fact): Card {
  return {
    context: CHRONICLE_CHANNEL,
    author: authorLine("Season", "what it added"),
    title: `Season ${factNum(f, "season")} added to the world`,
    description: `${seasonAdded(f)} Play made all of it, nobody designed any of it, and the world keeps every one.`,
    picture: "form",
    footer: "Traces that never reached a line faded at the close; everything promoted stays.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** The most notes the epoch card lists; the rest are counted. */
export const EPOCH_NOTES_MOST = 10;
/** structural: the longest one note's line runs. */
const NOTE_MOST = 200;

/**
 * The rules a season runs on from now (GDD 17.6, 18.5): the changes a
 * player may see, in words with their units, and a count of the rest.
 * Null for an epoch that leaves the book as it was: a roll-key step alone
 * is never told.
 */
export function epochNotesCard(ev: api.StoryEvent, lex?: Lexicon): Card | null {
  const f = ev.fact;
  const notes = ev.epoch;
  const from = notes?.from ?? factStr(f, "from");
  const to = notes?.to ?? factStr(f, "to");
  if (from && from === to) return null;
  const season = notes?.season ?? factNum(f, "season");
  const title = `Season ${season} runs on new rules`;
  const seen = notes?.seen ?? [];
  const lines = seen.slice(0, EPOCH_NOTES_MOST).map((n) => `• ${noteLine(n, lex)}`);
  if (seen.length > EPOCH_NOTES_MOST) lines.push(`and ${num(seen.length - EPOCH_NOTES_MOST)} more`);
  const intro = !notes
    ? "The world took new rules as the season began."
    : seen.length
      ? "The world took new rules as the season began. What changed that you can see:"
      : "The world took new rules as the season began; none of the changes is one you can see.";
  const unseen = notes?.unseen ?? 0;
  return {
    context: CHRONICLE_CHANNEL,
    author: authorLine("Season", "new rules"),
    title,
    description: [intro, ...lines].join("\n"),
    picture: artPicture(ev.art, title),
    fields: unseen
      ? [
          {
            name: "Not shown",
            value: `and ${plural(unseen, "change")} you will not see: how the world draws and runs itself.`,
          },
        ]
      : [],
    footer: "What was made before keeps its numbers; only what comes next runs on these.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** The visible sheets as a player knows them; an area entry covers its whole area. */
const SHEET_WORDS: Record<string, string> = {
  "items.materials": "materials",
  "items.tiers": "item tiers",
  "items.processes": "processes",
  "items.methods": "methods",
  "items.slots": "item slots",
  "items.traits": "traits",
  "items.pairings": "tag pairings",
  "items.starts": "starting kit",
  "growth.xp-by-deed": "xp by deed",
  "growth.exploit-offers": "exploit offers",
  "fights.odds-bands": "odds bands",
  "fights.options": "fight options",
  "fights.states": "fight states",
  "fights.hunts": "hunts",
  wear: "wear",
  "economy.params": "economy rules",
  "economy.standing": "standing",
  "economy.route-risk": "route risk",
  "goals.params": "goal rules",
  mounts: "mounts",
  "settlements.structures": "structures",
  "settlements.guild-works": "guild works",
  "settlements.params": "settlement rules",
  "classes.classes": "classes",
  "classes.abilities": "abilities",
  "classes.params": "class rules",
  "puzzles.families": "machines",
  "puzzles.practice": "machine practice",
  "puzzles.params": "machine rules",
  "puzzles.titles": "titles",
  liveops: "staged events",
  "alignment.bands": "alignment bands",
  "alignment.acts": "alignment acts",
  "theft.kinds": "theft",
};

/** A sheet in words: as a player knows it, else its last part, a params sheet by its area. */
function sheetWords(sheet: string): string {
  const [area = sheet, part = ""] = sheet.split(".");
  const known = SHEET_WORDS[sheet] ?? SHEET_WORDS[area];
  if (known) return known;
  return part === "params" || !part ? `${idWords(area)} rules` : idWords(part);
}

/** A row's name with any number standing alone written as an id: "Drop 1" reads "Drop #1". */
function rowName(name: string): string {
  return bareNumbers(name).length ? name.replace(/(^|\s)(\d[\d,]*)(?=\s|$)/g, "$1#$2") : name;
}

/** A column in words: "durabilityCost" reads "durability cost", "a.b" reads "a b". */
function columnWords(column: string): string {
  return column
    .replace(/\./g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
}

/** One note as a line: what changed, then from what to what. */
export function noteLine(n: api.EpochNote, lex?: Lexicon): string {
  const where = sheetWords(n.sheet);
  const what = capitalise(
    rowName(n.name || readable(n.row.startsWith("#") ? `${where} row ${n.row}` : n.row)),
  );
  let line: string;
  switch (n.change) {
    case "added":
      line = `New in ${where}: ${what}`;
      break;
    case "removed":
      line = `Gone from ${where}: ${what}`;
      break;
    default: {
      const col = !n.column || n.column === "value" ? "" : columnWords(n.column);
      const head = `${what} (${where})${col ? `, ${col}` : ""}`;
      const span = changeWords(n, col, lex);
      line = span ? `${head}: ${span}` : `${head}: changed`;
      if (bareNumbers(line).length) line = `${head}: changed`;
    }
  }
  if (bareNumbers(line).length) line = `A row of ${where} changed`;
  return line.length > NOTE_MOST ? `${line.slice(0, NOTE_MOST - 1)}…` : line;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** Units a number reads after it, by the sheet's unit tag. */
const AFTER: Record<string, [one: string, many: string]> = {
  coin: ["coin", "coin"],
  goods: ["goods", "goods"],
  pts: ["pts", "pts"],
  durability: ["durability", "durability"],
  xp: ["xp", "xp"],
  load: ["load", "load"],
  health: ["health", "health"],
  defence: ["defence", "defence"],
  standing: ["standing", "standing"],
  weight: ["weight", "weight"],
  tiles: ["tile", "tiles"],
  ticks: ["tick", "ticks"],
  days: ["day", "days"],
  beat: ["beat", "beats"],
  "event-points": ["event point", "event points"],
  seconds: ["s", "s"],
  ratio: ["times", "times"],
};
/** Units a number reads after its unit word: "tier 2". */
const BEFORE = new Set(["level", "tier"]);

/** "before to after" in words, or "" when the values cannot be told safely. */
function changeWords(n: api.EpochNote, col: string, lex?: Lexicon): string {
  const a = n.before ?? "";
  const b = n.after ?? "";
  if (NUMBER.test(a) && NUMBER.test(b)) return numberSpan(a, b, n.unit ?? "", col);
  const unit = n.unit ?? "";
  if (unit === "text") return "reworded";
  if (unit === "parts" || /^[[{]/.test(a) || /^[[{]/.test(b)) return "";
  if (unit === "flag") return `${a || "no"} to ${b || "no"}`;
  const words = (v: string) => {
    if (!v) return "none";
    const tags = unit === "tag" || unit === "tags";
    return v
      .split(/,\s*/)
      .map((x) => (tags && lex ? tagName(x, lex) : idWords(x)))
      .join(", ");
  };
  return `${words(a)} to ${words(b)}`;
}

/** A plain decimal as a card shows it: thousands with commas, a true minus. */
function decimal(v: string): string {
  const neg = v.startsWith("-");
  const [whole = "0", frac] = (neg ? v.slice(1) : v).split(".");
  const s = `${num(Number(whole))}${frac ? `.${frac}` : ""}`;
  return neg ? `−${s}` : s;
}

function numberSpan(a: string, b: string, unit: string, col: string): string {
  const x = Number(a);
  const y = Number(b);
  if (unit === "percent") return `${decimal(a)}% to ${decimal(b)}%`;
  if (unit === "chance") return `${percentOf(x)} to ${percentOf(y)}`;
  if (unit === "ms") return `${decimal(String(x / 1000))} s to ${decimal(String(y / 1000))} s`;
  if (BEFORE.has(unit)) return `${unit} ${decimal(a)} to ${unit} ${decimal(b)}`;
  const after = AFTER[unit];
  if (after) return `${decimal(a)} to ${decimal(b)} ${y === 1 ? after[0] : after[1]}`;
  if (unit === "band-steps")
    return `${countWords(x, "band step")} to ${countWords(y, "band step")}`;
  // A count or a gauge reads in its column's own noun where that is a unit, else in words.
  const noun = col.split(" ").at(-1) ?? "";
  if (UNITS.has(noun)) return `${decimal(a)} to ${decimal(b)} ${noun}`;
  if (unit === "gauge") return `${decimal(a)} to ${decimal(b)} points`;
  return `${spelled(x)} to ${spelled(y)}`;
}

/** A fraction as a percentage: 0.25 reads 25%. */
function percentOf(x: number): string {
  return `${Number((x * 100).toFixed(2))}%`;
}

const SMALL_WORDS = [
  "none",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** A count with no unit of its own, in words: past twelve it is a value. */
function spelled(x: number): string {
  return Number.isInteger(x) && x >= 0 && x < SMALL_WORDS.length
    ? SMALL_WORDS[x]!
    : `value ${decimal(String(x))}`;
}
