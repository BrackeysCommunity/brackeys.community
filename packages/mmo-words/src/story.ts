import { claimSideName, promotionNoun, seasonAddedWhat, SIDE_NAMES } from "./emergence.ts";
import { amount, capital, list, num, outOf, plural, readable, signed, ticks } from "./units.ts";

/**
 * How the story reads: the chronicle's lines, an arc's sides, a trouble's
 * banner, the season and a pattern's point. Lines are made from facts and
 * never stored (GDD 12.1), and a line names guilds, places, factions,
 * notables, regions and counts, never a character (GDD 12.7): the public
 * channels must not name players who never agreed to it.
 */

export interface Ref {
  kind: string;
  id: string;
}
export interface Datum {
  k: string;
  n?: number;
  s?: string;
}
/** A fact as the wire carries it; only what a line reads. */
export interface StoryFact {
  kind: string;
  region?: string;
  subjects: Ref[];
  data: Datum[];
}

/**
 * What the setting and the world call things. `name` is a sheet row's
 * name, as the bot's Lexicon gives it; `ref` names a faction, region,
 * holding, settlement, tile, notable, NPC or guild, and is never asked
 * for a character. Without them a line falls back to plain words.
 */
export interface Names {
  name(sheet: string, id: string): string;
  ref?(r: Ref): string | undefined;
}

/** The key a ref's name is kept under in a map of names. */
export const refKey = (r: Ref) => `${r.kind}:${r.id}`;

/**
 * The names an arc's cast gives its refs, as a map for `Names.ref`; a
 * character's name is left out even where the viewer's own is given.
 */
export function castNames(arcs: { cast: (Ref & { name?: string })[] }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of arcs)
    for (const c of a.cast) if (c.name && c.kind !== CHARACTER) out.set(refKey(c), c.name);
  return out;
}

const CHARACTER = "character";

/** A sheet row's name, or its id made readable; "" for no id. */
function rowName(sheet: string, id: string, names?: Names): string {
  if (!id) return "";
  return names?.name(sheet, id) || readable(id);
}

/** The scope whose arcs are troubles, named from story.troubles. */
const SETTLEMENT_SCOPE = "settlement";
/** The side or outcome a lapsed stage or arc names. */
const LAPSED = "lapsed";

/** Trouble names where an id alone reads badly; a pack's own name still wins. */
const TROUBLE_NAMES: Record<string, string> = {
  "thief-in-walls": "Thief in the walls",
};

/** An arc template's name: a settlement's arc is a trouble, any other an arc. */
export function arcName(template: string, scope: string, names?: Names): string {
  return scope === SETTLEMENT_SCOPE
    ? troubleName(template, names)
    : rowName("story.arcs", template, names);
}

/** A fact's arc by its template name, named by the scope it carries. */
export function factArcName(f: StoryFact, names?: Names): string {
  const scope = f.subjects.find((r) => r.kind === "scope")?.id ?? "";
  return arcName(f.data.find((d) => d.k === "template")?.s ?? "", scope, names);
}

/** A trouble's name by its kind. */
export function troubleName(kind: string, names?: Names): string {
  const own = names?.name("story.troubles", kind);
  if (own && own !== readable(kind)) return own;
  return TROUBLE_NAMES[kind] ?? rowName("story.troubles", kind, names);
}

/**
 * A side's name by its row id. Where the setting gives it no name of its
 * own, a rival claim's side is named by its seat when `at` is given.
 */
export function sideName(id: string, names?: Names, at = ""): string {
  const own = names?.name("story.sides", id);
  if (own && own !== readable(id)) return own;
  return claimSideName(id, at) ?? SIDE_NAMES[id] ?? rowName("story.sides", id, names);
}

/** Whether a fact tells of a stage, arc or thread that lapsed. */
export function isLapsed(f: StoryFact): boolean {
  const d = f.data.find((x) => x.k === "lapsed");
  if (d) return !!d.n;
  return f.data.some((x) => (x.k === "side" || x.k === "outcome") && x.s === LAPSED);
}

/** A common noun mid-sentence: "Raid" reads "raid", "Raider Compact" stays. */
function lower(s: string): string {
  return /[A-Z]/.test(s.slice(1)) ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

/** A name after "the": "the raid", and "The siege" not doubled. */
function the(name: string): string {
  const l = lower(name);
  return /^the /i.test(l) ? l : `the ${l}`;
}

/** What a thing is called when the world gives it no name. */
const NAMELESS: Record<string, string> = {
  faction: "a faction",
  region: "a region",
  holding: "a holding",
  settlement: "a settlement",
  tile: "a place",
  notable: "a notable",
  npc: "a local",
  guild: "a guild",
};

/** A fact read through the names it is told with. */
class Reading {
  constructor(
    readonly f: StoryFact,
    readonly names?: Names,
  ) {}

  n(k: string): number {
    return this.f.data.find((d) => d.k === k)?.n ?? 0;
  }
  s(k: string): string {
    return this.f.data.find((d) => d.k === k)?.s ?? "";
  }
  has(k: string): boolean {
    return this.f.data.some((d) => d.k === k);
  }
  /** The first datum whose key starts with a prefix. */
  prefixed(p: string): number {
    return this.f.data.find((d) => d.k.startsWith(p))?.n ?? 0;
  }
  row(sheet: string, id: string): string {
    return rowName(sheet, id, this.names);
  }
  /** A ref's name, "" when the world gives none. A character is never named. */
  known(r: Ref | undefined): string {
    if (!r || r.kind === CHARACTER) return "";
    return this.names?.ref?.(r)?.trim() ?? "";
  }
  /** A ref's name, or plain words for it. */
  called(r: Ref | undefined, kind = r?.kind ?? ""): string {
    return this.known(r) || NAMELESS[kind] || "somewhere";
  }
  subjects(kind: string): Ref[] {
    return this.f.subjects.filter((r) => r.kind === kind);
  }
  /** The nth subject of a kind, named. */
  subject(kind: string, i = 0): string {
    return this.called(this.subjects(kind)[i], kind);
  }
  /** The fact's own region, named, or "" when it has none the world names. */
  regionName(): string {
    return this.f.region ? this.known({ kind: "region", id: this.f.region }) : "";
  }
  region(): string {
    return this.regionName() || NAMELESS.region!;
  }
  /** " in Dunmarch", or "" where the region has no name. */
  where(): string {
    const r = this.regionName();
    return r ? ` in ${r}` : "";
  }
  /** The place a fact is about: its settlement datum, or a settlement subject. */
  place(): string {
    const ref = this.has("settlement")
      ? { kind: "settlement", id: String(this.n("settlement")) }
      : this.subjects("settlement")[0];
    return this.called(ref, "settlement");
  }
  template(): string {
    return factArcName(this.f, this.names) || "An arc";
  }
  trouble(): string {
    return troubleName(this.s("template"), this.names) || "trouble";
  }
  side(id = this.s("side")): string {
    return sideName(id, this.names) || "a side";
  }
  stage(): string {
    return `Stage ${num(this.n("stage") + 1)}`;
  }
  /** "Stage 2: The walls", or "Stage 2" where the stage has no id. */
  stageNamed(): string {
    const name = this.row("story.stages", this.s("stageId"));
    return name ? `${this.stage()}: ${name}` : this.stage();
  }
  occasion(): string {
    return this.row("story.occasions", this.s("occasion")) || "An occasion";
  }
  /** What an arc's cast is called, past the arc itself and any character. */
  cast(): string[] {
    const out: string[] = [];
    for (const r of this.f.subjects) {
      const name = this.known(r);
      if (name && !out.includes(name)) out.push(name);
    }
    return out.slice(0, CAST_SHOWN);
  }
  /** A promotion's name from its name datum, or the type's noun: "a road". */
  promoted(type: string): string {
    return this.s("name") || `a ${promotionNoun(type)}`;
  }
  /** A caravan's trade route by its name datum: "the Ashford–Kell's Rest route". */
  route(): string {
    const name = this.s("name");
    return name ? `the ${name} route` : "a trade route";
  }
  /** A settlement named by a numeric datum. */
  settlement(k: string): string {
    return this.has(k)
      ? this.called({ kind: "settlement", id: String(this.n(k)) })
      : "a settlement";
  }
  /** A material's name; a found one the names do not know yet is "a new material". */
  material(id: string): string {
    if (!id) return "a material";
    const name = this.row("items.materials", id);
    return id.startsWith(FOUND) && name === readable(id) ? "a new material" : name;
  }
  /** The pattern a board id names: "triangle@3,4" is a triangle's. */
  pattern(board = this.s("board"), rule = this.s("rule")): string {
    const id = rule || (board.includes("@") ? board.split("@")[0]! : "");
    return id ? this.row("story.pattern-puzzles", id) : "pattern";
  }
}

// structural: an arc's line names at most this many of its cast.
const CAST_SHOWN = 3;

/** The id prefix of a material play found (GDD 9.3). */
const FOUND = "found.";

/** What a legend made from an item is told by. */
const ITEM_REF = "item:";

/** A promotion as the chronicle tells it, by its type (GDD 13.2). */
function promotionLine(r: Reading): string {
  const type = r.s("type");
  const name = r.s("name");
  const named = r.promoted(type);
  const of = r.s("of");
  const site = () => the(r.row("map.site-kinds", of) || "site");
  switch (type) {
    case "road":
      return r.s("via") === "pattern"
        ? `Solving a pattern laid ${named}${r.where()}: a road to the nearest settlement.`
        : `${capital(named)} formed${r.where()}: walked so often that it became a road.`;
    case "camp":
      return `${capital(named)} took shape${r.where()}: ${site()} there was cleared so often that it gained a station.`;
    case "haunt":
      return `${capital(named)}${r.where()} is haunted now: so many fell at ${site()} that scavengers lead what lives there.`;
    case "route": {
      const ends =
        r.has("a") && r.has("b") ? ` between ${r.settlement("a")} and ${r.settlement("b")}` : "";
      return `${capital(named)} became a trade route: so much was hauled${ends} that caravans now run it.`;
    }
    case "style":
      return `A way of fighting was named${r.where()}: ${named}. So many won with it that the region's creatures begin to adapt against it.`;
    case "variant": {
      const kind = r.row("creatures.archetypes", of) || "creatures";
      const resists = r.s("resists");
      const drops = r.s("material") ? ` It drops ${lower(r.material(r.s("material")))}.` : "";
      return `${capital(named)} appeared${r.where()}: the region's ${lower(kind)} adapted against how it was beaten${resists ? `, and now resists ${resists}` : ""}.${drops}`;
    }
    case "material": {
      const base = r.s("base") ? `, a harder kind of ${lower(r.material(r.s("base")))}` : "";
      return `A new material came into the world${r.where()}: ${name || "unnamed yet"}${base}, dropped by the region's adapted creatures.`;
    }
    case "legend":
      return of.startsWith(ITEM_REF)
        ? `${capital(named)} became a legend: an item named in so many great deeds this season.`
        : `${capital(named)} became a legend${r.where()}: so many tried and failed to bring it down that it lives on in the telling.`;
    case "custom":
      return `${capital(named)} became a custom: posted season after season, it is now posted by the world each season.`;
    case "class":
      return `A hidden class was found: ${r.row("classes.classes", of) || named}. Its path is open to everyone now.`;
    case "masters": {
      const family = r.row("puzzles.families", of);
      return `${capital(named)}: so many masters${family ? ` of ${family}` : ""} call it home that its bench sets those puzzles easier.`;
    }
    default:
      return `Something new became part of the world${r.where()}${name ? `: ${name}` : ""}.`;
  }
}

/** What each kind of staged event is called (GDD 14.4). */
const STAGED_KINDS: Record<string, string> = {
  contest: "a contest",
  hardship: "a hardship",
  drop: "a drop",
  hunt: "a hunt",
  fair: "a fair",
  vault: "a competing vault",
  pattern: "a pattern",
};

/** Who staged an event: a server's admins or its staff, by the server guild's name. */
function stager(r: Reading): string {
  const label = r.s("label");
  const of = label ? ` of ${label}` : " of a server";
  return r.s("role") === "staff" ? `staff${of}` : `the admins${of}`;
}

/** A staged event's kind in words: "a drop". */
function stagedWhat(r: Reading): string {
  return STAGED_KINDS[r.s("kind")] ?? "an event";
}

/** The event points a staff staging cost, as a clause; admins pay nothing. */
function stagedCost(r: Reading): string {
  return r.s("role") === "staff" && r.n("points") > 0
    ? `, for ${amount(r.n("points"), "event points")}`
    : "";
}

/** A staging opened (GDD 14.4): who staged what where, for how long, and its crates. */
function stagedOpenedLine(r: Reading): string {
  const days = r.n("days");
  const crates = r.n("crates");
  const span = days > 0 ? ` for ${plural(days, "day")}` : "";
  const open = crates > 0 ? `: ${plural(crates, "crate")} to open` : "";
  return `${capital(stager(r))} staged ${stagedWhat(r)} at ${r.place()}${span}${stagedCost(r)}${open}.`;
}

/** A staging ordered to open later: the fact carries no open time, so the line names none. */
function stagedOrderedLine(r: Reading): string {
  const days = r.n("days");
  const span = days > 0 ? ` for ${plural(days, "day")}` : "";
  return `${capital(stager(r))} staged ${stagedWhat(r)} at ${r.place()}${span}${stagedCost(r)}, to open later.`;
}

/** How a staging came to its close, by the reason the world gives. */
function stagedHow(why: string): string {
  switch (why) {
    case "ended":
      return "was ended early";
    case "":
    case LAPSED:
      return "closed";
    default:
      return "could not open, and closed";
  }
}

/** A staging closed: how, and what came of it, its crates opened and its winners. */
function stagedClosedLine(r: Reading): string {
  const parts: string[] = [];
  if (r.n("crates") > 0) parts.push(`${plural(r.n("crates"), "crate")} opened`);
  if (r.n("winners") > 0) parts.push(`won by ${plural(r.n("winners"), "character")}`);
  const what = stagedWhat(r);
  const tail = parts.length ? `: ${list(parts)}` : "";
  return `${capital(what.replace(/^an? /, "the "))} ${stager(r)} staged at ${r.place()} ${stagedHow(r.s("why"))}${tail}.`;
}

/** A competing vault taken: the crew by its size and the staged haul, never who sat in it. */
function vaultTakenLine(r: Reading): string {
  const label = r.s("label");
  const by = label ? ` ${label} staged` : "";
  const family = r.row("puzzles.families", r.s("family"));
  const machine = family ? `, its ${family} at level ${num(r.n("level"))} solved first` : "";
  const goods = r.n("goods") > 0 ? `, for ${amount(r.n("goods"), "goods")} staged there` : "";
  return `A crew of ${plural(r.n("seats"), "member")} took the competing vault${by} near ${r.place()}${machine}${goods}.`;
}

/** The standing key of the hidden syndicate, whose name no public line gives. */
const SYNDICATE = "syndicate";
/** A faction standing key's prefix; its index is the faction ref's "f-<n>". */
const FACTION_KEY = "faction:";

/** The faction a crime fact is about: its faction subject, else its faction datum; "" when unnamed. */
function crimeFaction(r: Reading): string {
  const subject = r.subjects("faction")[0];
  if (subject) return subject.id === SYNDICATE ? "" : r.known(subject);
  const key = r.s("faction");
  return key.startsWith(FACTION_KEY)
    ? r.known({ kind: "faction", id: `f-${key.slice(FACTION_KEY.length)}` })
    : "";
}

/** Whether a crime fact's victim is the syndicate. */
function isSyndicate(r: Reading): boolean {
  return r.s("faction") === SYNDICATE || r.subjects("faction").some((f) => f.id === SYNDICATE);
}

/** " at Ashford" for a fact's settlement datum (−1 is none) or subject, else " in Dunmarch". */
function crimeAt(r: Reading): string {
  if (r.has("settlement"))
    return r.n("settlement") >= 0 ? ` at ${r.settlement("settlement")}` : r.where();
  const s = r.subjects("settlement")[0];
  return s ? ` at ${r.called(s)}` : r.where();
}

/** What a theft took: "6 goods of scrap, an item and 12 coin"; "" for nothing counted. */
function haul(r: Reading): string {
  const parts: string[] = [];
  const units = r.n("units");
  const material = r.s("material");
  if (units > 0)
    parts.push(
      material
        ? `${amount(units, "goods")} of ${lower(r.material(material))}`
        : amount(units, "goods"),
    );
  if (r.s("item")) parts.push("an item");
  if (r.n("coin") > 0) parts.push(amount(r.n("coin"), "coin"));
  return list(parts);
}

/** Each theft kind as the chronicle tells it: what was done, and what a thief tried. */
const THEFT_DONE: Record<string, (victim: string, at: string, what: string) => string> = {
  lift: (victim, at, what) => `A thief lifted ${what} from ${victim}${at}`,
  burgle: (victim, at, what) => `A thief broke into ${victim}${at} and took ${what}`,
  waylay: (victim, at, what) => `A thief waylaid ${victim}${at} and took ${what}`,
};
const THEFT_TRIED: Record<string, (victim: string) => string> = {
  lift: (victim) => `lift from ${victim}`,
  burgle: (victim) => `break into ${victim}`,
  waylay: (victim) => `waylay ${victim}`,
};

/** Who a theft was from, never the character: the NPC, the faction's store, or a caravan. */
function theftVictim(r: Reading, kind: string): string {
  switch (kind) {
    case "lift":
      return r.known(r.subjects("npc")[0]) || "a local";
    case "burgle": {
      const f = crimeFaction(r);
      return f ? `${f}'s store` : "a faction's store";
    }
    case "waylay":
      return "a caravan";
    default:
      return "someone";
  }
}

/** A theft (GDD 6.5): by kind and outcome, told of "a thief" and never the character. */
function theftLine(r: Reading): string {
  const kind = r.s("kind");
  const victim = theftVictim(r, kind);
  const at = crimeAt(r);
  const tried = THEFT_TRIED[kind]?.(victim) ?? "steal";
  const worth = r.n("worth");
  switch (r.s("outcome")) {
    case "lost":
      return `A thief was caught trying to ${tried}${at}, and took nothing. The watch is looking for them.`;
    case "empty":
      return `A thief tried to ${tried}${at}, and found nothing to take.`;
    default: {
      const took = haul(r);
      const what = took || (worth ? `goods worth ${amount(worth, "coin")}` : "what was there");
      const done = THEFT_DONE[kind]?.(victim, at, what) ?? `A thief stole ${what}${at}`;
      const side = r.s("side") ? ", for the side preying on the road" : "";
      const goods = r.n("units") > 0 || !!r.s("item");
      const value = took && goods && worth ? `, worth ${amount(worth, "coin")}` : "";
      const seen = r.n("witnessed")
        ? "It was seen, and the watch is looking for them."
        : "Nobody saw who.";
      return `${done}${value}${side}. ${seen}`;
    }
  }
}

/** How a faction was betrayed, by the act that did it. */
const BETRAYED_BY: Record<string, string> = {
  theft: "robbed by one it trusted",
};

/** A betrayal (GDD 5.10): names the faction only, and never the hidden syndicate. */
function betrayedLine(r: Reading): string {
  if (isSyndicate(r))
    return "Someone the back rooms trusted turned on them, and they will not forget it.";
  const how = BETRAYED_BY[r.s("act")] ?? "betrayed by one it trusted";
  return `${capital(crimeFaction(r) || NAMELESS.faction!)} was ${how}, and will hold a grudge.`;
}

/** What a trouble's mark counts, by the trouble's kind. */
const TROUBLE_UNIT: Record<string, string> = {
  raid: "defence",
  fire: "goods",
  corruption: "points",
  shortage: "provisions",
  sickness: "provisions",
  panic: "coin",
  "thief-in-walls": "defence",
};

/** What a side's mark counts, by what it wants. */
const WANT_UNIT: Record<string, string> = {
  goods: "goods",
  beats: "points",
  reach: "characters",
  defence: "defence",
  sold: "coin",
};

/** The unit a trouble's mark counts in, by its kind. */
export function troubleUnit(kind: string): string {
  return TROUBLE_UNIT[kind] ?? "goods";
}

/** The unit a side's mark counts in, by what it wants. */
export function wantUnit(wants: string): string {
  return WANT_UNIT[wants] ?? "goods";
}

const ROLES: Record<string, string> = { leader: "leader", factor: "factor", captain: "captain" };

const BANDS: Record<string, string> = {
  opening: "its opening",
  rising: "its rising",
  last: "its last stretch",
  finale: "its finale",
};

const DIRECTIONS = ["east", "north-east", "north-west", "west", "south-west", "south-east"];

/** "south-west (#4)": a facing in words, with the value players set it to. */
function facing(v: number, unknown = `#${num(v)}`): string {
  const d = DIRECTIONS[v];
  return d ? `${d} (#${num(v)})` : unknown;
}

/** "point #2": a pattern's point, counted from 1. */
const point = (i: number) => `point #${num(i + 1)}`;

/**
 * What a pattern's clue says (GDD 4.13), without giving the solution away.
 * `named` names a point by its index; chat counts them, the Activity letters them.
 */
export function clueLine(f: StoryFact, named: (i: number) => string = point): string {
  const r = new Reading(f);
  const a = named(r.n("point"));
  const b = named(r.n("other"));
  const n = r.n("n");
  switch (r.s("says")) {
    case "after":
      return `${a} comes before ${b}`;
    case "offset":
      return n === 0
        ? `${b} holds the same value as ${a}`
        : `${b} is set ${amount(n, n === 1 ? "value" : "values")} past ${a}`;
    case "facing":
      return `${a} faces ${facing(n, "its own way")}`;
    case "live":
      return `${a}'s run is ${n ? "live" : "dead"}`;
    case "missing":
      return `the gap lies from ${a} to ${b}`;
    case "near":
      return `the hidden point is within ${plural(n, "point")} of ${a}`;
    default:
      return "it says something of the pattern";
  }
}

type Line = (r: Reading) => string;

const LINES: Record<string, Line> = {
  // Arcs and their stages.
  "arc.cast": (r) => {
    const cast = r.cast();
    return `${r.template()} began${r.where()}${cast.length ? `, with ${list(cast)}` : ""}. ${r.stageNamed()}.`;
  },
  "arc.stage-began": (r) => `${r.template()}${r.where()} moved on. ${r.stageNamed()}.`,
  "arc.stage-ended": (r) => {
    if (isLapsed(r.f))
      return `${r.template()}${r.where()}, ${r.stage()}: it lapsed with no side's mark met.`;
    const backers = r.n("backers");
    return `${r.template()}${r.where()}, ${r.stage()}: ${lower(r.side())} carried it${backers ? `, with ${plural(backers, "backer")}` : ""}.`;
  },
  "arc.ended": (r) =>
    isLapsed(r.f)
      ? `${r.template()} ended${r.where()}: it lapsed, and the world went its own way.`
      : `${r.template()} ended${r.where()}: ${lower(r.side(r.s("outcome")))} won.`,
  "side.backed": (r) => `${capital(r.side())} gained a backer.`,
  "character.marked": (r) =>
    `A backer was marked: ambushes find them more often${r.n("days") ? ` for ${plural(r.n("days"), "day")}` : " until the arc ends"}.`,
  "thread.cast": (r) => {
    const npc = r.known(r.subjects("npc")[0]) || r.known(r.subjects("notable")[0]);
    return `A personal thread began: ${lower(r.template())}${npc ? `, with ${npc}` : ""}.`;
  },
  "thread.ended": (r) =>
    isLapsed(r.f)
      ? `A personal thread ended: ${lower(r.template())} lapsed.`
      : `A personal thread ended: ${lower(r.template())}, settled by ${lower(r.side())}.`,

  // Troubles and occasions.
  "trouble.started": (r) => {
    return `${capital(r.trouble())} at ${r.place()}: ${amount(r.prefixed("mark:"), troubleUnit(r.s("template")))} to hold it off by the day's end.`;
  },
  "trouble.held": (r) => {
    const backers = r.n("backers");
    return `${capital(r.place())} held off ${the(r.trouble())}${backers ? `, with ${plural(backers, "backer")}` : ""}.`;
  },
  "trouble.lost": (r) => `${capital(r.place())} lost to ${the(r.trouble())}.`,
  "occasion.began": (r) => {
    const days = r.n("days");
    const span = days ? ` for ${plural(days, "day")}` : "";
    switch (r.s("occasion")) {
      case "caravan":
        return `A caravan came to ${r.place()}: its bids pay more${span}.`;
      case "migration":
        return `The herds are moving near ${r.place()}: a hunt opened${span}.`;
      case "seam":
        return `A new seam opened near ${r.place()}${span}.`;
      default:
        return `${capital(r.occasion())} at ${r.place()}${span}.`;
    }
  },
  "occasion.ended": (r) => `${capital(r.occasion())} at ${r.place()} ended.`,
  "structure.damaged": (r) => {
    const st = r.row("settlements.structures", r.s("structure")) || "structure";
    const tail = r.n("closed")
      ? ", and it is closed until rebuilt"
      : `, ${amount(r.n("condition"), "pts")} left`;
    return `${capital(the(st))} at ${r.place()} took ${amount(r.n("points"), "pts")} of damage${tail}.`;
  },

  // Settlements and cities.
  "settlement.founded": (r) =>
    `${capital(r.subject("guild"))} founded ${r.s("name") || r.place()}${r.where()}.`,
  "settlement.chartered": (r) => `${capital(r.subject("guild"))} took the charter of ${r.place()}.`,
  "settlement.ruined": (r) => {
    const guild = r.s("guild") ? r.called({ kind: "guild", id: r.s("guild") }) : "";
    const coin = r.n("treasury");
    return `${capital(r.place())} fell to ruin${guild && coin ? `; ${guild} took back ${amount(coin, "coin")} from its treasury` : ""}.`;
  },
  "city.project": (r) => `${capital(r.place())} set out to become a city.`,
  "city.raised": (r) =>
    `${capital(r.place())} became a city${r.n("coin") ? `, for ${amount(r.n("coin"), "coin")}` : ""}.`,
  "city.fell-back": (r) =>
    `${capital(r.place())} fell back from a city: too few came through it this season.`,
  "faction.city": (r) => {
    const region = r.s("region") ? r.known({ kind: "region", id: r.s("region") }) : r.regionName();
    return `${capital(r.subject("faction"))} raised its city at ${r.place()}${region ? ` in ${region}` : ""}.`;
  },
  "structure.raised": (r) =>
    `${capital(the(r.row("settlements.structures", r.s("structure")) || "structure"))} at ${r.place()} rose to tier ${num(r.n("tier"))}.`,

  // Seasons.
  "season.began": (r) => `Season ${num(r.n("season"))} began: ${plural(r.n("days"), "day")} long.`,
  "season.band": (r) =>
    `Season ${num(r.n("season"))} reached ${BANDS[r.s("band")] ?? lower(r.row("story.days", r.s("band")))}: day ${num(r.n("from"))} to day ${num(r.n("to"))}.`,
  "season.finale": (r) => {
    const season = `Season ${num(r.n("season"))}`;
    if (!r.s("template")) return `The finale of ${season} came, with no finale cast.`;
    const outcome = r.s("outcome");
    const how = !outcome
      ? ""
      : isLapsed(r.f)
        ? ", and it lapsed"
        : `, won by ${lower(r.side(outcome))}`;
    return `The finale of ${season}: ${lower(r.template())}${how}.`;
  },
  "season.closed": (r) =>
    `Season ${num(r.n("season"))} closed after ${plural(r.n("days"), "day")}.`,
  "season.epoch": (r) => `Season ${num(r.n("season"))} runs on new rules.`,
  "season.turned": (r) => {
    const season = r.row("world.seasons", r.s("season"));
    return season ? `The world turned to ${the(season)}.` : "The weather turned.";
  },

  // The ring and the core.
  "core.opened": (r) =>
    `The core opened: ${r.n("towers") ? `all ${plural(r.n("towers"), "tower")} of the ring fell` : "the ring fell"} this season.`,
  "core.sealed": () => "The core was sealed again.",

  // Patterns.
  "pattern.clue": (r) => `A clue to ${the(r.pattern())} was found${r.where()}: ${clueLine(r.f)}.`,
  "pattern.set": (r) => `A point of ${the(r.pattern())} was set${r.where()}.`,
  "pattern.haywire": (r) =>
    `A wrong attempt at ${the(r.pattern())} went haywire: a surge of ${amount(r.n("threat"), "threat")}${r.where()}.`,
  "pattern.lapsed": (r) =>
    `${capital(plural(r.n("points"), "point"))} of ${the(r.pattern())} lapsed, held too long unsolved.`,
  "pattern.solved": (r) => `${capital(the(r.pattern()))} was solved${r.where()}.`,
  "pattern.placed": (r) =>
    `Solving ${the(r.pattern(r.s("from"), ""))} showed another: ${the(r.pattern("", r.s("rule")))}.`,
  "pattern.cache": (r) =>
    `${capital(the(r.row("story.caches", r.s("cache")) || "cache"))} opened: ${amount(r.n("goods"), "goods")}, split among those who set it.`,

  // NPCs.
  "npc.called": (r) => `${capital(r.subject("npc"))} called on a traveller on the road.`,
  "npc.woke": (r) => `${capital(r.subject("npc"))} stirred again after a long quiet.`,

  // The world's own moves.
  "region.gauge-moved": (r) => {
    const g = r.s("gauge") || "threat";
    return `${capital(r.region())}: ${signed(r.n("by"), g)}, now ${amount(r.n("value"), g)}.`;
  },
  "region.surge": (r) => `A surge of ${amount(r.n("threat"), "threat")} struck ${r.region()}.`,
  "region.overrun": (r) =>
    `${capital(r.region())} was overrun${r.n("threat") ? `: ${amount(r.n("threat"), "threat")}` : ""}.`,
  "region.overrun-ended": (r) => `${capital(r.region())} is no longer overrun.`,
  "region.ambushes": (r) =>
    `${capital(r.region())} reached ${amount(r.n("threat"), "threat")}: ambushes on its roads.`,
  "region.raids": (r) =>
    `${capital(r.region())} reached ${amount(r.n("threat"), "threat")}: raiders ride out from it.`,
  "region.worked-out": (r) =>
    `${capital(r.region())} reached ${amount(r.n("scarcity"), "scarcity")}: its yields halve.`,
  "region.unrest": (r) =>
    `${capital(r.region())} reached ${amount(r.n("unrest"), "unrest")}: fire and panic are near.`,
  "region.corruption-spreads": (r) =>
    `${capital(r.region())} reached ${amount(r.n("corruption"), "corruption")}, and it spreads.`,
  "region.prospers": (r) =>
    `${capital(r.region())} prospers: ${amount(r.n("prosperity"), "prosperity")}.`,
  "region.discovered": (r) => `${capital(r.region())} came into sight.`,
  "find.first-sight": (r) =>
    `A tier ${num(r.n("tier"))} find was sighted for the first time${r.where()}.`,
  "land.calmer": (r) => `The land round ${r.place()} grew calmer.`,
  "weather.landfall": (r) =>
    `${capital(the(r.row("world.weather", r.s("kind")) || "storm"))} made landfall at ${r.place()}.`,
  "holding.fell": (r) => {
    const f = r.subjects("faction")[0];
    const tail = r.n("settlement") ? ", and the settlement there with it" : "";
    return f
      ? `${capital(r.called(f))} lost its holding in ${r.region()}${tail}.`
      : `The holding in ${r.region()} fell${tail}.`;
  },
  "faction.expanded": (r) => `${capital(r.subject("faction"))} expanded into ${r.region()}.`,
  "faction.fortified": (r) =>
    `${capital(r.subject("faction"))} fortified ${r.region()}: ${amount(r.n("defence"), "defence")}.`,
  "faction.raided": (r) =>
    `${capital(r.subject("faction"))} raided ${r.subject("faction", 1)} in ${r.region()}.`,
  "faction.besieged": (r) =>
    `${capital(r.subject("faction"))} besieged ${r.subject("faction", 1)} in ${r.region()}.`,
  "faction.betrayed": (r) =>
    `${capital(r.subject("faction"))} betrayed ${r.subject("faction", 1)}${r.where()}.`,
  "character.betrayed": betrayedLine,
  "faction.withdrew": (r) => `${capital(r.subject("faction"))} withdrew from ${r.region()}.`,
  "faction.migrated": (r) => `${capital(r.subject("faction"))} moved its people to ${r.region()}.`,
  "faction.starving": (r) => `${capital(r.subject("faction"))} is starving.`,
  "faction.seated": (r) =>
    `${capital(r.subject("faction"))} came into sight, seated in ${r.region()}.`,
  "faction.fell": (r) => `${capital(r.subject("faction"))} fell: it holds no region now.`,
  "faction.peace": (r) =>
    `${capital(r.subject("faction"))} and ${r.subject("faction", 1)} made peace.`,
  "faction.grudge": (r) =>
    `${capital(r.subject("faction"))} took up a grudge against ${r.subject("faction", 1)}${r.n("days") ? ` for ${plural(r.n("days"), "day")}` : ""}.`,
  "faction.split": (r) => {
    const led = r.known(r.subjects("notable")[0]);
    return `${capital(r.subject("faction", 1))} broke away from ${r.subject("faction")}${led ? `, led by ${led}` : ""}.`;
  },
  "notable.died": (r) => {
    const role = ROLES[r.s("role")];
    return `${capital(r.subject("notable"))}, ${role ? `${role} of` : "of"} ${r.subject("faction")}, died.`;
  },
  "notable.promoted": (r) =>
    `${capital(r.subject("notable"))} rose to ${ROLES[r.s("role")] ?? "a new post"} of ${r.subject("faction")}.`,
  "notable.appointed": (r) =>
    `${capital(r.subject("notable"))} was made ${ROLES[r.s("role")] ?? "an officer"} of ${r.subject("faction")}.`,
  "notable.defected": (r) =>
    `${capital(r.subject("notable"))} left ${r.subject("faction")} for ${r.subject("faction", 1)}.`,
  "notable.loyalty-moved": (r) =>
    `${capital(r.subject("notable"))}'s loyalty to ${r.subject("faction")} ${r.n("by") < 0 ? "waned" : "grew"}.`,
  "node.seam": (r) =>
    `A seam of ${r.row("items.materials", r.s("material"))} opened${r.where()}: a node there gained ${amount(r.n("stock"), "goods")}.`,

  // What play made part of the world (GDD 13.2).
  promotion: promotionLine,
  "promotion.renamed": (r) =>
    `${capital(r.s("was") || "A find")} was renamed ${r.s("name") || "by its finder"}.`,
  "road.grew": (r) => `${capital(r.promoted("road"))} grew${r.where()}.`,
  "road.cut": (r) =>
    `${capital(r.promoted("road"))}${r.where()} was cut: no quicker than open ground${r.n("days") ? ` for ${plural(r.n("days"), "day")}` : ""}.`,
  "road.tolled": (r) =>
    `${capital(r.promoted("road"))}${r.where()} is tolled: ${amount(r.n("coin"), "coin")} a crossing${r.n("days") ? ` for ${plural(r.n("days"), "day")}` : ""}.`,
  "caravan.departed": (r) =>
    `A caravan left ${r.settlement("from")} on ${r.route()}, carrying ${amount(r.n("units"), "goods")}.`,
  "caravan.arrived": (r) =>
    `A caravan on ${r.route()} came in to ${r.settlement("to")} with ${amount(r.n("units"), "goods")}.`,
  "caravan.robbed": (r) =>
    `Raiders robbed a caravan on ${r.route()}${r.where()}: ${amount(r.n("units"), "goods")} taken, left where it was struck.`,
  "caravan.lost": (r) =>
    `A caravan on ${r.route()} was lost${r.where()}: its ${amount(r.n("units"), "goods")} lie where it stopped.`,
  "legend.laid": (r) => `${capital(r.promoted("legend"))} was laid to rest${r.where()}.`,
  "custom.held": (r) =>
    `${capital(r.promoted("custom"))} was held at ${r.subject("settlement")}: posted by the world, paid from its treasury.`,
  "custom.skipped": (r) =>
    `${capital(r.promoted("custom"))} was not held at ${r.subject("settlement")} this season: its treasury was ${amount(r.n("short"), "coin")} short.`,
  "material.looted-first": (r) =>
    `${capital(r.s("name") || r.material(r.s("material")))} was taken for the first time${r.where()}.`,
  "season.added": (r) => {
    const what = seasonAddedWhat(r.f);
    return what
      ? `Season ${num(r.n("season"))} added to the world: ${what}.`
      : `Season ${num(r.n("season"))} added nothing new to use.`;
  },
  "emergence.started": () =>
    "The world began to keep what is done in it: from now on play can make roads, camps and legends.",

  // What players did, told without them.
  "kind.discovered": (r) => {
    const proc = r.s("process") ? `, by ${lower(r.row("items.processes", r.s("process")))}` : "";
    return `A tier ${num(r.n("tier"))} kind was made for the first time${proc}${r.where()}.`;
  },
  "hunt.slain": (r) => {
    const by = r.n("hunters");
    return `${capital(the(`${r.row("creatures.archetypes", r.s("archetype")) || "great"} hunt`))}${r.where()} was brought down${by ? ` by ${plural(by, "presser")}` : ""}.`;
  },
  "guardian.slain": (r) => {
    const by = r.subjects(CHARACTER).length;
    return `A dungeon's guardian${r.where()} was slain${by ? ` by a party of ${plural(by, "member")}` : ""}.`;
  },
  "dungeon.slain-first": (r) =>
    `A dungeon's guardian${r.where()} was slain for the first time: its naming is open.`,
  "dungeon.named": (r) => `A dungeon${r.where()} was named ${r.s("name") || "at last"}.`,
  "name.renamed": (r) => {
    const name = r.s("name");
    return name
      ? `Something${r.where()} was renamed: it is called ${name} now.`
      : `Something${r.where()} was renamed.`;
  },
  "guild.founded": (r) => `${capital(r.s("name") || r.subject("guild"))} was founded.`,
  "goal.vow-broken": () => "A vow on a guild's board was broken.",

  // A server's staging, told of its admins or staff and never a character (GDD 14.5).
  "staged.ordered": stagedOrderedLine,
  "staged.opened": stagedOpenedLine,
  "staged.closed": stagedClosedLine,
  "vault.taken": vaultTakenLine,

  // Crime, told of "a thief" and never the character (GDD 6.5).
  "theft.made": theftLine,
  "watch.caught": (r) => {
    const worth = r.n("worth");
    return `The watch${crimeAt(r)} ran down a fleeing thief and took back what was stolen${worth ? `, worth ${amount(worth, "coin")}` : ""}.`;
  },
};

/** Every kind the chronicle has its own line for. */
export function chronicleKinds(): string[] {
  return Object.keys(LINES);
}

/** A fact as one line of the chronicle, naming no character (GDD 12.7). */
export function chronicleLine(f: StoryFact, names?: Names): string {
  const r = new Reading(f, names);
  const line = LINES[f.kind];
  return line ? line(r) : `${readable(f.kind.replace(/\./g, " "))}${r.where()}.`;
}

/** A side as the wire carries it (`api.Side`). */
export interface StorySide {
  title: string;
  wants: string;
  tag?: string;
  mark: number;
  filled: number;
  backers: number;
  pay: number;
  at: string;
  sponsor: string;
  opponent?: string;
  mine: boolean;
}

/** What a side asks, and where: "provisions to Ashford". */
function wanted(s: StorySide, names?: Names): string {
  const at = s.at || "its place";
  switch (s.wants) {
    case "goods": {
      const what = !s.tag
        ? "any goods"
        : s.tag === "provisions"
          ? "provisions"
          : names?.name("items.materials", s.tag) || readable(s.tag);
      return `${what} to ${at}`;
    }
    case "beats":
      return `beats won in ${at}`;
    case "reach":
      return `reaching ${at}`;
    case "defence":
      return `defence at ${at}`;
    case "sold":
      return `sales to faction bids at ${at}`;
    default:
      return at;
  }
}

/**
 * One side of a stage: "Garrison · provisions to Ashford · 120 of 250
 * provisions · 3 backers · pays 300 coin · for Militia, against Raider
 * Compact".
 */
export function sideLine(s: StorySide, names?: Names): string {
  return sideParts(s, names).join(" · ");
}

/** What sideLine joins, the side's title first. */
export function sideParts(s: StorySide, names?: Names): string[] {
  const unit = s.wants === "goods" && s.tag === "provisions" ? "provisions" : wantUnit(s.wants);
  const parts = [
    s.title,
    wanted(s, names),
    outOf(Math.min(s.filled, s.mark), s.mark, unit),
    plural(s.backers, "backer"),
  ];
  if (s.pay > 0) parts.push(`pays ${amount(s.pay, "coin")}`);
  if (s.sponsor)
    parts.push(s.opponent ? `for ${s.sponsor}, against ${s.opponent}` : `for ${s.sponsor}`);
  if (s.mine) parts.push("you back it");
  return parts;
}

/** A side past its title: what it wants, who backs it, what it pays and for whom. */
export function sideDetail(s: StorySide, names?: Names): string {
  return sideParts(s, names).slice(1).join(" · ");
}

/** A trouble as the wire carries it (`api.Trouble`). */
export interface StoryTrouble {
  kind: string;
  title: string;
  why?: StoryFact;
  mark: number;
  defence: number;
  ends: number;
}

/**
 * A trouble's banner (GDD 12.5): what it is, where, how far its mark is
 * filled, when it ends, and why it came. `now` is the world's tick.
 */
export function troubleBanner(
  t: StoryTrouble,
  o: { place?: string; now?: number; names?: Names } = {},
): string {
  const unit = troubleUnit(t.kind);
  const parts = [
    `${t.title || troubleName(t.kind, o.names)}${o.place ? ` at ${o.place}` : ""}: ${outOf(Math.min(t.defence, t.mark), t.mark, unit)} to hold it off`,
  ];
  if (o.now !== undefined) parts.push(`ends in ${ticks(Math.max(0, t.ends - o.now))}`);
  if (t.why) parts.push(`why: ${chronicleLine(t.why, o.names)}`);
  return parts.join(" · ");
}

/** The season as the wire carries it (`api.Season`). */
export interface StorySeason {
  n: number;
  day: number;
  days: number;
  band: string;
}

/** "Season 1 · day 12 of 42 days · its rising · 30 days to the close". */
export function seasonLine(s: StorySeason): string {
  const left = Math.max(0, s.days - s.day);
  return [
    `Season ${num(s.n)}`,
    `day ${num(s.day)} of ${plural(s.days, "day")}`,
    BANDS[s.band] ?? lower(readable(s.band)),
    left ? `${plural(left, "day")} to the close` : "it closes today",
  ].join(" · ");
}

/** A pattern's point as the wire carries it (`api.PatternPoint`). */
export interface StoryPoint {
  board: string;
  kind: string;
  place: string;
  family?: string;
  point: number;
  points: number;
  values: number;
  held?: number;
  solved: boolean;
  clues?: StoryFact[];
}

/** Each kind of pattern: what it is called and what it asks of its points, without the answer. */
const PATTERN_KINDS: Record<string, { name: string; asks: string }> = {
  state: { name: "settings", asks: "every point set to its value" },
  order: { name: "an order", asks: "the points set in their order" },
  alignment: { name: "facings", asks: "every point turned to face its way" },
  connection: { name: "live runs", asks: "the live runs joined" },
  completion: { name: "the missing one", asks: "the missing point found" },
  constellation: { name: "the hidden one", asks: "the hidden point found" },
};

/** What a kind of pattern is called: "settings"; a kind not known here is named as written. */
export function patternKind(kind: string): string {
  return PATTERN_KINDS[kind]?.name ?? readable(kind);
}

/** What a point holds, by its pattern's kind: "holds setting #2", "is raised". */
export function heldLine(kind: string, v: number): string {
  const tag = `#${num(v)}`;
  switch (kind) {
    case "state":
      return `holds setting ${tag}`;
    case "alignment":
      return `faces ${facing(v)}`;
    case "order":
      return "is woken this round";
    case "connection":
      return "is repaired";
    case "completion":
      return "is raised";
    case "constellation":
      return v === 0 ? "is found" : "is activated";
    default:
      return `holds ${tag}`;
  }
}

/**
 * The point stood on: "Triangle · point #2 of 3 points · a pylon, set by
 * a Circuit · held at value 3 of 4 values · 2 clues found". It shows only
 * what the viewer holds and has found, never the solution.
 */
export function patternLine(p: StoryPoint, names?: Names): string {
  const r = new Reading({ kind: "", subjects: [], data: [] }, names);
  const parts = [
    capital(r.pattern(p.board, "")),
    `${point(p.point)} of ${plural(p.points, "point")}`,
    `${p.place === "vault" ? "the vault" : `a ${p.place || "point"}`}${p.family ? `, set by a ${r.row("puzzles.families", p.family)}` : ", set by a delivery"}`,
  ];
  if (p.solved) parts.push("solved");
  else {
    if (p.held === undefined) parts.push("not set by you");
    else
      parts.push(
        p.values > 1
          ? `held at value ${num(p.held + 1)} of ${plural(p.values, "value")}`
          : "held by you",
      );
    const asks = PATTERN_KINDS[p.kind]?.asks;
    if (asks) parts.push(`it wants ${asks}`);
  }
  const clues = p.clues?.length ?? 0;
  parts.push(clues ? `${plural(clues, "clue")} found` : "no clue found yet");
  return parts.join(" · ");
}
