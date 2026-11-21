import {
  type Button,
  BUTTON_LABEL_MAX,
  type EmbedField,
  OPTIONS_MAX,
  PER_ROW,
  type Select,
  SELECT_LABEL_MAX,
} from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import type { Picture } from "../card.ts";
import { type Action, encodeId, target } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, num, ticks } from "../units.ts";

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
export function banner(place: { banner: string; name: string }, extra = ""): Picture {
  return { media: place.banner, alt: `Banner of ${place.name}${extra}` };
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
    default:
      return capitalise(`${f.kind.replace(/[.-]/g, " ")}.`);
  }
}

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
