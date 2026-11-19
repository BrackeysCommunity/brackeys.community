import type { Button } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { encodeId } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, num, ticks } from "../units.ts";

/** Where every hub card appears and who sees it. */
export const PRIVATE = "Your hub · only you can see this";

/** A button the bot answers, by action and target, at a state version. */
export function btn(
  label: string,
  action: string,
  target = "",
  version = 0,
  extra: Partial<Extract<Button, { kind: "page" }>> = {},
): Button {
  return { kind: "page", label, customId: encodeId(action, target, version), ...extra };
}

export function back(version: number): Button {
  return btn("Hub", "hub", "", version, { emoji: "↩" });
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

function datum(f: api.Fact, k: string): api.Datum | undefined {
  return f.data.find((d) => d.k === k);
}
const n = (f: api.Fact, k: string) => datum(f, k)?.n ?? 0;
const s = (f: api.Fact, k: string) => datum(f, k)?.s ?? "";

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
      return `${f.kind.replace(/[.-]/g, " ")}.`.replace(/^./, (c) => c.toUpperCase());
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
