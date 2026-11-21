import {
  type Button,
  buttonRows,
  type EmbedField,
} from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR, type Picture } from "../card.ts";
import { target } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, bandShort, num, plural, ticks } from "../units.ts";
import type { HuntPost } from "../world.ts";
import { back, banner, btn, goodsLine, launch, PRIVATE } from "./common.ts";

/**
 * A hunt's cards (GDD 7.6): the live hunt as one presser sees it, and the
 * card in the game channel, edited as its health falls and closed with its
 * spoils table. Spoils are split by health removed.
 */

/** Where the game channel's cards appear and who sees them. */
export const GAME_CHANNEL = "Game channel · everyone in the server can see this";

const BAR = 10;

/** Health as a bar of ten, and in numbers with its unit. */
export function healthLine(health: number, max: number): string {
  const full = max > 0 ? Math.round((Math.max(0, health) * BAR) / max) : 0;
  return `\`${"█".repeat(full)}${"░".repeat(BAR - full)}\` ${num(health)} of ${amount(max, "health")}`;
}

function huntPicture(h: HuntPost, lex: Lexicon): Picture | "form" {
  return h.banner
    ? { media: h.banner, alt: `${lex.name("creatures.archetypes", h.creature)} on its tile` }
    : "form";
}

/** Tiles between two hexes. */
export function hexDistance(a: api.Hex, b: api.Hex): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r));
}

/** The pressers as a table, most health removed first. */
function pressersTable(pressers: readonly api.HuntPresser[]) {
  return {
    header: ["Presser", "Removed (health)"],
    rows: pressers
      .slice(0, 10)
      .map((p) => [`${p.name}${p.you ? " (you)" : ""}`.slice(0, 24), num(p.removed)]),
  };
}

/**
 * A live hunt as one presser sees it: the pool, who has pressed and how much
 * they removed, the viewer's share now, and the press. A press's options come
 * with the viewer's own read; without them it is pressed in the Activity.
 */
export function huntCard(
  o: api.Options,
  here: api.Here,
  h: HuntPost,
  view: api.HuntView | undefined,
  lex: Lexicon,
  notice?: string,
): Card {
  const v = o.version;
  const creature = lex.name("creatures.archetypes", h.creature);
  const away = hexDistance(o.at, h.at);
  const reach = away <= 1 && !here.floor?.floor;
  const fields: EmbedField[] = [
    { name: "Leaves in", value: ticks(Math.max(0, h.ends - o.tick)), inline: true },
    { name: "Hunters", value: plural(h.pressers.length, "presser"), inline: true },
    { name: "Where", value: reach ? "in reach" : `${plural(away, "tile")} away`, inline: true },
  ];
  if (view)
    fields.push({
      name: "Your part",
      value: `${amount(view.mine, "health")} removed: ${view.share}% of the spoils as it stands`,
    });
  fields.push({
    name: "Spoils, the most each line can roll",
    value: goodsLine(h.spoils, lex) || "nothing",
  });
  const options = (view?.canPress ? (view.options ?? []) : []).filter((x) => !x.puzzle);
  const buttons: Button[] = options.slice(0, 4).map((x) =>
    btn(
      `${lex.name("fights.options", x.id)} · ${bandShort(x.band)}`,
      "h-press",
      target(":", h.id, x.id),
      v,
      {
        style: x.kind === "win" ? "primary" : "secondary",
      },
    ),
  );
  if (reach && !h.closed) buttons.push(launch("Press in the Activity", "hunt", v));
  if (!reach && !h.closed) buttons.push(btn("Go to it", "goto", target(",", h.at.q, h.at.r), v));
  buttons.push(back(v));
  return {
    context: PRIVATE,
    author: authorLine("Hunt", creature, h.closed ? "closed" : "live"),
    title: notice ?? h.name,
    description: `${healthLine(h.health, h.max)}${reach ? "" : "\nStand on its tile or the next to press it."}`,
    picture: h.banner ? huntPicture(h, lex) : banner(here, `; ${creature} hunted nearby`),
    table: h.pressers.length ? pressersTable(view?.pressers ?? h.pressers) : undefined,
    fields,
    footer:
      "A won press removes health by its score. The spoils roll once at the kill and split by health removed.",
    rows: buttonRows(buttons),
    colour: COLOUR.rust,
    failable: options
      .slice(0, 4)
      .filter((x) => x.band !== "certain")
      .map((x) => lex.name("fights.options", x.id)),
  };
}

/** A live hunt's card in the game channel: the pool, the window's end, and each presser's health removed. */
export function huntPostCard(h: HuntPost, lex: Lexicon): Card {
  const creature = lex.name("creatures.archetypes", h.creature);
  return {
    context: GAME_CHANNEL,
    author: authorLine("Hunt", creature, "live"),
    title: h.name,
    description: `${healthLine(h.health, h.max)}\nIt leaves when its window ends, at tick ${h.ends}, whether or not anyone goes after it.`,
    picture: huntPicture(h, lex),
    table: h.pressers.length ? pressersTable(h.pressers) : undefined,
    fields: [
      { name: "Hunters", value: plural(h.pressers.length, "presser"), inline: true },
      { name: "Spoils, the most each line can roll", value: goodsLine(h.spoils, lex) || "nothing" },
    ],
    footer: "Anyone on its tile or the next may press once a tick. Spoils split by health removed.",
    rows: [{ buttons: [btn("Join the hunt", "hunt", h.id, 0, { style: "danger" })] }],
    colour: COLOUR.rust,
  };
}

/** A hunt's card once it has closed: slain, with its spoils table, or gone with the health it kept. */
export function huntClosedCard(h: HuntPost, lex: Lexicon): Card {
  const creature = lex.name("creatures.archetypes", h.creature);
  const shares = h.shares ?? [];
  return {
    context: GAME_CHANNEL,
    author: authorLine("Hunt", creature, h.slain ? "slain" : "gone"),
    title: h.slain ? `${h.name}: slain` : `${h.name}: it got away`,
    description: h.slain
      ? "The spoils rolled once at the kill and were split by health removed: the parts sum to the roll."
      : `It left with ${num(h.health)} of ${amount(h.max, "health")}. Nothing is paid beyond the hauls already won.`,
    picture: huntPicture(h, lex),
    table: h.slain
      ? {
          header: ["Presser", "Removed (health)", "Spoils (goods)"],
          rows: shares
            .slice(0, 12)
            .map((s) => [
              s.name.slice(0, 20),
              num(s.removed),
              goodsLine(s.goods, lex) || "nothing",
            ]),
        }
      : h.pressers.length
        ? pressersTable(h.pressers)
        : undefined,
    fields: h.slain
      ? [
          { name: "Rolled", value: goodsLine(h.rolled ?? [], lex) || "nothing" },
          { name: "Hunters", value: plural(shares.length, "presser"), inline: true },
        ]
      : [{ name: "Hunters", value: plural(h.pressers.length, "presser"), inline: true }],
    footer: "A hunt is a creature many wear down over a window; this one is over.",
    rows: [],
    colour: h.slain ? COLOUR.signal : COLOUR.ash,
  };
}
