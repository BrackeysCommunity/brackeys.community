import { amount, num, outOf, plural, signed, ticks } from "./units.ts";

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

function readable(id: string): string {
  const s = id.replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

/** "a, b and c". */
function list(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
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
    if (!id) return "";
    return this.names?.name(sheet, id) || readable(id);
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
    return this.row("story.arcs", this.s("template")) || "An arc";
  }
  trouble(): string {
    return this.row("story.troubles", this.s("template")) || "trouble";
  }
  side(id = this.s("side")): string {
    return this.row("story.sides", id) || "a side";
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
  /** The pattern a board id names: "triangle@3,4" is a triangle's. */
  pattern(board = this.s("board"), rule = this.s("rule")): string {
    const id = rule || (board.includes("@") ? board.split("@")[0]! : "");
    return id ? this.row("story.pattern-puzzles", id) : "pattern";
  }
}

// structural: an arc's line names at most this many of its cast.
const CAST_SHOWN = 3;

/** What a trouble's mark counts, by the trouble's kind. */
const TROUBLE_UNIT: Record<string, string> = {
  raid: "defence",
  fire: "goods",
  corruption: "points",
  shortage: "provisions",
  sickness: "provisions",
  panic: "coin",
};

/** What a side's mark counts, by what it wants. */
const WANT_UNIT: Record<string, string> = {
  goods: "goods",
  beats: "points",
  reach: "characters",
  defence: "defence",
  sold: "coin",
};

const ROLES: Record<string, string> = { leader: "leader", factor: "factor", captain: "captain" };

const BANDS: Record<string, string> = {
  opening: "its opening",
  rising: "its rising",
  last: "its last stretch",
  finale: "its finale",
};

const DIRECTIONS = ["east", "north-east", "north-west", "west", "south-west", "south-east"];

/** "#2": a pattern's point, counted from 1. */
const point = (i: number) => `point #${num(i + 1)}`;

/** What a pattern's clue says (GDD 4.13), without giving the solution away. */
export function clueLine(f: StoryFact): string {
  const r = new Reading(f);
  const a = point(r.n("point"));
  const b = point(r.n("other"));
  const n = r.n("n");
  switch (r.s("says")) {
    case "after":
      return `${a} comes before ${b}`;
    case "offset":
      return n === 0
        ? `${b} holds the same value as ${a}`
        : `${b} is set ${amount(n, n === 1 ? "value" : "values")} past ${a}`;
    case "facing":
      return `${a} faces ${DIRECTIONS[n] ?? "its own way"}`;
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
    if (r.n("lapsed") || r.s("side") === "lapsed")
      return `${r.template()}${r.where()}, ${r.stage()}: it lapsed with no side's mark met.`;
    const backers = r.n("backers");
    return `${r.template()}${r.where()}, ${r.stage()}: ${lower(r.side())} carried it${backers ? `, with ${plural(backers, "backer")}` : ""}.`;
  },
  "arc.ended": (r) =>
    r.n("lapsed") || r.s("outcome") === "lapsed"
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
    r.n("lapsed") || r.s("side") === "lapsed"
      ? `A personal thread ended: ${lower(r.template())} lapsed.`
      : `A personal thread ended: ${lower(r.template())}, settled by ${lower(r.side())}.`,

  // Troubles and occasions.
  "trouble.started": (r) => {
    const unit = TROUBLE_UNIT[r.s("template")] ?? "goods";
    return `${capital(r.trouble())} at ${r.place()}: ${amount(r.prefixed("mark:"), unit)} to hold it off by the day's end.`;
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
      : outcome === "lapsed"
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
  promotion: (r) => `A promotion was made${r.where()}.`,

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
  "guild.founded": (r) => `${capital(r.s("name") || r.subject("guild"))} was founded.`,
  "goal.vow-broken": () => "A vow on a guild's board was broken.",
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
  const unit =
    s.wants === "goods" && s.tag === "provisions" ? "provisions" : (WANT_UNIT[s.wants] ?? "goods");
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
  return parts.join(" · ");
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
  const unit = TROUBLE_UNIT[t.kind] ?? "goods";
  const parts = [
    `${t.title || readable(t.kind)}${o.place ? ` at ${o.place}` : ""}: ${outOf(Math.min(t.defence, t.mark), t.mark, unit)} to hold it off`,
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

/** What each kind of pattern asks of its points, without the answer. */
const PATTERN_ASKS: Record<string, string> = {
  state: "every point set to its value",
  order: "the points set in their order",
  alignment: "every point turned to face its way",
  connection: "the live runs joined",
  completion: "the missing point found",
  constellation: "the hidden point found",
};

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
    if (PATTERN_ASKS[p.kind]) parts.push(`it wants ${PATTERN_ASKS[p.kind]}`);
  }
  const clues = p.clues?.length ?? 0;
  parts.push(clues ? `${plural(clues, "clue")} found` : "no clue found yet");
  return parts.join(" · ");
}
