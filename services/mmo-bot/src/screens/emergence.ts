import type { EmbedField } from "../../../../packages/discord-kit/src/index.ts";
import { countWords, seasonAdded } from "../../../../packages/mmo-words/src/index.ts";
import type * as api from "../api.ts";
import { WhyAdapted } from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { capitalise, type Lexicon, readable } from "../lexicon.ts";
import { amount, plural } from "../units.ts";
import { factNum, factStr } from "./common.ts";
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
