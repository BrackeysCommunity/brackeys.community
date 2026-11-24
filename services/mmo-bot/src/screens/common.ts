import {
  type Button,
  BUTTON_LABEL_MAX,
  type EmbedField,
  OPTIONS_MAX,
  PER_ROW,
  type Select,
  SELECT_LABEL_MAX,
} from "../../../../packages/discord-kit/src/index.ts";
import { bannerAlt } from "../../../../packages/mmo-words/src/alt.ts";
import {
  chronicleKinds,
  chronicleLine,
  type Names,
  refKey,
} from "../../../../packages/mmo-words/src/index.ts";
import type * as api from "../api.ts";
import type { Picture } from "../card.ts";
import { type Action, encodeId, type LaunchCard, launchTarget, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, num, outOf, plural, seconds, signed, ticks } from "../units.ts";

export { placedLine } from "../../../../packages/mmo-words/src/index.ts";

/** A unix time as Discord draws it live: "in 2 minutes". */
export function relative(ms: number): string {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/** Goods as a comma list of amounts, empty when there are none. */
export function goodsLine(goods: readonly api.Goods[], lex: Lexicon): string {
  return goods.map((g) => amount(g.units, lex.material(g.material))).join(", ");
}

/** Where every hub card appears and who sees it. */
export const PRIVATE = "Your hub · only you can see this";

/** A button the bot answers, by action and target, at a state version. */
export function btn(
  label: string,
  action: Action,
  target = "",
  version = 0,
  extra: Partial<Extract<Button, { kind: "page" }>> = {},
): Button {
  return { kind: "page", label, customId: encodeId(action, target, version), ...extra };
}

export function back(version: number): Button {
  return btn("Hub", "hub", "", version, { emoji: "↩" });
}

/**
 * The button that opens the Activity from a card. Discord answers its press
 * with the launch itself, so it never reaches the world.
 */
export function launch(label: string, from: LaunchCard, version: number, npc?: string): Button {
  return btn(label, "launch", launchTarget(from, npc), version, { style: "primary" });
}

/** A tinker's bench as one line: today's uses against the cap, and the lessons waiting. */
export function benchLine(b: api.BenchHere): string {
  const lessons = b.lessons ? ` · ${plural(b.lessons, "lesson")} waiting` : "";
  return `${outOf(b.uses, b.usesCap, "uses")} today${lessons}`;
}

/**
 * A downed character's two ways out. Crawling stays open while carried:
 * it is how the carried leave a rescuer who has walked off.
 */
export function downButtons(o: api.Options, v: number): Button[] {
  const r = o.rescue;
  return [
    btn(r?.carriedBy ? "Leave them and crawl" : "Crawl out", "crawl", "", v, {
      style: "danger",
      disabled: o.long?.kind === "crawl",
    }),
    btn("Call for help", "help", "", v, {
      style: "primary",
      disabled: !!r?.called || !!r?.carriedBy,
    }),
  ];
}

/** The six directions, as arrows and compass points, by direction index. */
export const DIRECTIONS = [
  { arrow: "→", name: "E" },
  { arrow: "↗", name: "NE" },
  { arrow: "↖", name: "NW" },
  { arrow: "←", name: "W" },
  { arrow: "↙", name: "SW" },
  { arrow: "↘", name: "SE" },
];

/** A select holds this many options, and a row this many buttons. */
export const SELECT_MOST = OPTIONS_MAX;
export const ROW_MOST = PER_ROW;

/** A select's option, its label and description cut to what Discord takes. */
export function option(label: string, value: string, description?: string): Select["options"][0] {
  return {
    label: label.slice(0, SELECT_LABEL_MAX),
    value,
    ...(description ? { description: description.slice(0, SELECT_LABEL_MAX) } : {}),
  };
}

/**
 * One page of a list too long for a select; its last option turns the page,
 * with page:<n> as its value.
 */
export function paged<T>(
  all: readonly T[],
  page: number,
  of: (x: T) => Select["options"][0],
  what: string,
): Select["options"] {
  const per = SELECT_MOST - 1;
  const from = page * per < all.length ? page * per : 0;
  const out = all.slice(from, from + per).map(of);
  if (all.length > per)
    out.push({
      label: from + per < all.length ? `More ${what}` : `Back to the first ${what}`,
      value: target(":", "page", from + per < all.length ? from / per + 1 : 0),
    });
  return out;
}

/** A button's label cut to what Discord takes. */
export function buttonLabel(label: string): string {
  return label.slice(0, BUTTON_LABEL_MAX);
}

/** The default picture: the banner of a place; extra goes on the alt text. */
export function banner(
  here: { banner: string; name: string; place?: api.Here["place"] },
  extra = "",
): Picture {
  const p = here.place;
  return {
    media: here.banner,
    alt: bannerAlt({
      name: here.name,
      city: p?.city?.city,
      ruined: p?.ruined,
      overrun: p?.overrun,
      trouble: p?.trouble?.kind,
      troubleTitle: p?.trouble?.title,
      extra,
    }),
  };
}

/** Distinct prices at given percentages of ref (each at least 1 coin). */
export function priceLadder(ref: number, percents: number[]): { pct: number; price: number }[] {
  const seen = new Set<number>();
  const out: { pct: number; price: number }[] = [];
  for (const pct of percents) {
    const price = Math.max(1, Math.round((ref * pct) / 100));
    if (seen.has(price)) continue;
    seen.add(price);
    out.push({ pct, price });
  }
  return out;
}

function datum(f: api.Fact, k: string): api.Datum | undefined {
  return f.data.find((d) => d.k === k);
}
/** A fact's number under a key, or 0. */
export const factNum = (f: api.Fact, k: string) => datum(f, k)?.n ?? 0;
/** A fact's string under a key, or "". */
export const factStr = (f: api.Fact, k: string) => datum(f, k)?.s ?? "";
const n = factNum;
const s = factStr;

/** A station as one line: its name, tier and fee. */
export function stationLine(st: api.Station, lex: Lexicon): string {
  return `${lex.name("settlements.starting", st.kind)} (tier ${st.tier}, fee ${amount(st.fee, "coin")})`;
}

/** Ticks until a long action ends. */
export function timeLeft(o: api.Options): number {
  return Math.max(0, (o.long?.ends ?? o.tick) - o.tick);
}

export function conditionsField(o: api.Options): EmbedField {
  return {
    name: "Conditions",
    value: o.conditions.length ? o.conditions.join(", ") : "none",
    inline: true,
  };
}

/** The family a machine's fact names, as the setting calls it. */
function family(f: api.Fact, lex: Lexicon): string {
  return lex.name("puzzles.families", s(f, "family"));
}

/** "a level 3 Pin lock": the machine a fact is about. */
function machine(f: api.Fact, lex: Lexicon): string {
  const level = n(f, "level");
  return `a ${level ? `level ${level} ` : ""}${family(f, lex)}`;
}

/** How long a solve took, where the fact says. */
function took(f: api.Fact): string {
  const ms = n(f, "ms");
  return ms ? ` in ${seconds(ms)}` : "";
}

/** A fact as one templated line. Text is made from facts and never stored (GDD 12.1). */
export function factLine(f: api.Fact, lex: Lexicon): string {
  const mat = (k: string) => lex.material(s(f, k));
  switch (f.kind) {
    case "order.filled":
      return `Sold ${amount(n(f, "units"), mat("material"))} to a faction order for ${amount(n(f, "coin"), "coin")}, less a ${amount(n(f, "fee"), "coin")} fee.`;
    case "find.made":
      return `A ${s(f, "rarity")} find (${num(n(f, "chance"))}% of finds), by ${lex.name("tiles.triggers", s(f, "trigger")).toLowerCase()}: ${amount(n(f, "goods"), "goods")}${s(f, "item") ? " and an item" : ""}.`;
    case "kind.discovered":
      return `You were the first to make a tier ${n(f, "tier")} kind.`;
    case "craft.made":
      return `Made a tier ${n(f, "tier")} piece by ${lex.name("items.processes", s(f, "process")).toLowerCase()}.`;
    case "encounter.won":
      return `Won an encounter of ${amount(n(f, "beats"), "beats")}, carrying ${amount(n(f, "haul"), "goods")} out.`;
    case "encounter.lost":
      return "Lost an encounter, and the haul with it.";
    case "encounter.left":
      return "Backed out of an encounter.";
    case "encounter.held":
      return "Held an encounter to a standstill.";
    case "character.down":
      return "Went down.";
    case "character.crawled":
      return "Crawled out, wounded.";
    case "item.levelled":
      return `An item rose to level ${n(f, "to")}.`;
    case "item.picked":
      return `Took a milestone pick at level ${n(f, "level")}.`;
    case "item.broke":
      return "An item broke into salvage.";
    case "item.dormant":
      return "An item went dormant until it is repaired.";
    case "item.repaired":
      return `Repaired ${amount(n(f, "points"), "durability")}.`;
    case "travel.arrived":
      return `Arrived after ${ticks(n(f, "ticks"))}.`;
    case "travel.stopped":
      return `A journey stopped${s(f, "why") ? ` (${s(f, "why")})` : ""}.`;
    case "travel.ambushed":
      return "Ambushed on the road.";
    case "ambush.defaulted":
      return "An ambush you were away for took its default: backing out.";
    case "gather.done":
      return `Gathered ${amount(n(f, "units"), mat("material"))}.`;
    case "forage.done":
      return `Foraged ${amount(n(f, "units"), "provisions")}.`;
    case "mount.unfed":
      return `Your mount went unfed: it waits on ${amount(n(f, "owed"), "provisions")}.`;
    case "node.worked-out":
      return `A node of ${mat("material")} was worked out.`;
    case "dungeon.floor-cleared":
      return `Cleared floor ${n(f, "floor")} of a dungeon.`;
    case "region.overrun":
      return "A region was overrun.";
    case "kind.named":
      return "A kind was named.";
    case "machine.armed":
      return `Set to work on ${machine(f, lex)}${s(f, "source") === "pouch" ? ", the lock of a pouch" : ""}: its countdown started.`;
    case "puzzle.solved":
      return `Solved ${machine(f, lex)}${took(f)}${n(f, "master") ? ", and the panel behind it: a master's solve" : n(f, "clean") ? ", clean" : ""}.`;
    case "puzzle.haywire":
      return `${capitalise(machine(f, lex))}${s(f, "pouch") ? " on a pouch" : ""} ${n(f, "late") ? "ran out its countdown and went" : "went"} haywire: ${lex.name("puzzles.haywire", s(f, "haywire")).toLowerCase()}.`;
    case "puzzle.mastered":
      return `Mastered the ${family(f, lex)}: the title ${lex.name("puzzles.titles", s(f, "family"))} is held.`;
    case "bench.solved":
      return `Solved ${machine(f, lex)} at the tinker's bench: ${n(f, "uses") ? `${plural(n(f, "uses"), "use")} of practice` : "the day's bench uses are spent"}${n(f, "taught") ? ", and it is left as a lesson" : ""}.`;
    case "lesson.taken":
      return `A lesson in the ${family(f, lex)} was taken at the bench: ${plural(n(f, "uses"), "use")} of practice${n(f, "standing") ? `, and ${signed(n(f, "standing"), "standing")} to its teacher` : ""}.`;
    case "pouch.found":
      return `Found a locked pouch (${s(f, "rarity")}): ${amount(n(f, "goods"), "goods")} behind a ${family(f, lex)}.`;
    case "pouch.opened":
      return `Opened a locked pouch${took(f)}: ${amount(n(f, "goods"), "goods")}.`;
    case "party.formed":
      return "A party formed.";
    case "party.joined":
      return `Joined a party: ${plural(n(f, "members"), "member")} now.`;
    case "party.left":
      return "Left a party.";
    case "party.ended":
      return "A party ended.";
    case "party.dropped":
      return "Dropped off the leader's road.";
    case "party.beat":
      return `A party beat: ${n(f, "won")} of ${plural(n(f, "pressed"), "member")} won it.`;
    case "beat.won":
      return `Won a party beat with ${lex.name("fights.options", s(f, "option")).toLowerCase()}, scoring ${amount(n(f, "score"), "pts")}.`;
    case "beat.lost":
      return `Lost a party beat with ${lex.name("fights.options", s(f, "option")).toLowerCase()}.`;
    case "dungeon.entered":
    case "dungeon.reached":
      return `Reached floor ${n(f, "floor")} of a dungeon.`;
    case "dungeon.left":
      return `Climbed out of a dungeon from floor ${n(f, "floor")}.`;
    case "dungeon.forked":
      return "Took a way down at a fork.";
    case "dungeon.haunted":
      return "A dungeon turned haunted: too many have fallen in it lately.";
    case "dungeon.calm":
      return "A haunted dungeon grew calm again.";
    case "dungeon.slain-first":
      return "The first to slay a dungeon's guardian: theirs is the naming.";
    case "dungeon.named":
      return "A dungeon was given its name.";
    case "guardian.slain":
      return "A dungeon's guardian was slain.";
    case "guardian.worn":
      return `A dungeon's guardian was worn down to ${num(n(f, "health"))} of ${amount(n(f, "max"), "health")}.`;
    case "guardian.whole":
      return "A dungeon's guardian is whole again.";
    case "hunt.opened":
      return `A hunt opened: ${lex.name("creatures.archetypes", s(f, "archetype")).toLowerCase()}.`;
    case "hunt.pressed":
      return "Pressed a hunt.";
    case "hunt.wounded":
      return `Took ${amount(n(f, "health"), "health")} off a hunt.`;
    case "hunt.slain":
      return `A hunt was slain by ${plural(n(f, "hunters"), "presser")}.`;
    case "hunt.left":
      return `A hunt got away with ${num(n(f, "health"))} of ${amount(n(f, "max"), "health")}.`;
    case "key.made":
      return `Made a key to a dungeon from ${amount(n(f, "units"), mat("material"))}.`;
    case "key.used":
      return "Used a key: the third way opened.";
    case "machine.lost-race":
      return `Another party solved the ${lex.name("puzzles.families", s(f, "family"))} first: this one went haywire.`;
    case "track.followed":
      return "Followed a fled creature's track.";
    case "road.toll-paid":
      return n(f, "coin")
        ? `Paid a toll of ${amount(n(f, "coin"), "coin")} to cross a road.`
        : `Paid a toll in goods: ${amount(n(f, "units"), mat("material"))}.`;
    default:
      return CHRONICLED.has(f.kind)
        ? chronicleLine(f, storyNames(lex))
        : capitalise(`${f.kind.replace(/[.-]/g, " ")}.`);
  }
}

/** The names a story line is told with: the setting's rows, and the refs an arc's cast names. */
export function storyNames(lex: Lexicon, refs: ReadonlyMap<string, string> = new Map()): Names {
  return { name: (sheet, id) => lex.name(sheet, id), ref: (r) => refs.get(refKey(r)) };
}

/** A fact as the chronicle tells it, naming no character; a kind it has no line for as the hub does. */
export function storyLine(f: api.Fact, lex: Lexicon, refs?: ReadonlyMap<string, string>): string {
  return CHRONICLED.has(f.kind) ? chronicleLine(f, storyNames(lex, refs)) : factLine(f, lex);
}

const CHRONICLED = new Set(chronicleKinds());

/** The gauges that matter most at a place, with their unit. */
export function gauges(
  place: api.Place,
  lex: Lexicon,
  ids = ["threat", "scarcity", "corruption"],
): string {
  return ids
    .map((id) => place.gauges.find((g) => g.id === id))
    .filter((g): g is api.Gauge => !!g)
    .map((g) => `${lex.name("world.gauges", g.id)}: ${amount(g.value, g.id)}`)
    .join(" · ");
}

/** Units of a material among goods held, 0 for none. */
export function held(goods: readonly api.Goods[], material: string): number {
  return goods.find((g) => g.material === material)?.units ?? 0;
}

/** Units of a material or of provisions a purse holds: provisions are kept apart from goods. */
export function heldOf(purse: api.Purse, material: string): number {
  return material === "provisions" ? purse.provisions : held(purse.goods, material);
}
