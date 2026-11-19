import type { Button, EmbedField } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import type { Card } from "../card.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, ticks } from "../units.ts";
import { back, btn, DIRECTIONS, PRIVATE } from "./common.ts";

/** The map view and travel: a crop with fog and weather, six directions, go-to (GDD 6.1, 16.4). */
export function travelCard(
  o: api.Options,
  map: api.MapView,
  here: api.Here,
  lex: Lexicon,
  threatLine: number,
): Card {
  const v = o.version;
  const moves = DIRECTIONS.map((d, i) => {
    const m = o.moves.find((x) => x.dir === i);
    const label = m?.open
      ? `${d.arrow} ${d.name} · ${amount(m.ticks, m.ticks === 1 ? "tick" : "ticks")}`
      : `${d.arrow} ${d.name}`;
    return btn(label, "step", String(i), v, {
      disabled: !m?.open || !!o.long || !!o.fight,
      style: here.suggest?.dir === i ? "primary" : "secondary",
    });
  });
  const sites = map.tiles
    .filter((t) => t.site && !(t.hex.q === map.centre.q && t.hex.r === map.centre.r))
    .slice(0, 25);
  const rows: Card["rows"] = [{ buttons: moves.slice(0, 3) }, { buttons: moves.slice(3) }];
  if (sites.length && !o.long && !o.fight) {
    rows.push({
      select: {
        customId: `mm|goto||${v}`,
        placeholder: "Go to a place you have seen…",
        options: sites.map((t) => ({
          label: `${lex.name("map.landmarks", t.site!) === t.site ? siteName(t.site!) : lex.name("map.landmarks", t.site!)} (${lex.name("map.terrain", t.terrain)})`,
          value: `${t.hex.q},${t.hex.r}`,
        })),
      },
    });
  }
  const tail: Button[] = [btn("Why these costs", "why", "moves", v)];
  if (o.long?.kind === "travel") tail.push(btn("Stop here", "cancel", "", v, { style: "danger" }));
  tail.push(back(v));
  rows.push({ buttons: tail });
  const fields: EmbedField[] = [
    {
      name: "Here",
      value: `${here.name}, ${lex.name("map.terrain", here.place.tile.terrain).toLowerCase()}`,
      inline: true,
    },
    {
      name: "Conditions",
      value: o.conditions.length ? o.conditions.join(", ") : "none",
      inline: true,
    },
    { name: "Seen around you", value: amount(map.tiles.length, "tiles"), inline: true },
  ];
  if (here.suggest && !o.long) {
    const d = DIRECTIONS[here.suggest.dir]!;
    fields.push({
      name: "A first outing",
      value: `A site to explore ${amount(here.suggest.tiles, here.suggest.tiles === 1 ? "tile" : "tiles")} away: start ${d.arrow} ${d.name}.`,
    });
  }
  if (o.long?.kind === "travel") {
    fields.push({
      name: "On the road",
      value: `${amount(o.long.route?.length ?? 0, "tiles")} left, arriving in ${ticks(Math.max(0, o.long.ends - o.tick))}`,
    });
  }
  return {
    context: PRIVATE,
    author: o.long?.kind === "travel" ? "Travel · on the road" : "Travel · the map",
    title: o.long?.kind === "travel" ? "On the road" : "Which way?",
    description: `A step takes 1 to 3 ticks a tile by the ground. A journey of more than ${ticks(2)} eats provisions; it runs on while you are away, and stops before a region at ${amount(threatLine, "threat")} or more. Running out of provisions makes you hungry, not stuck.`,
    picture: {
      media: map.image,
      alt: `Map of ${amount(map.radius, "tiles")} round ${here.name}: fog over what nobody has entered, weather and threat shaded`,
    },
    fields,
    footer: "Each tile entered is a fact: the recap tells where the journey went.",
    rows,
    modifiers: true,
  };
}

function siteName(site: string): string {
  if (site === "starting-settlement") return "Settlement";
  if (site === "dungeon") return "Dungeon";
  return site.replace(/[-:]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** A journey just queued, or a step taken. */
export function journeyNotice(o: api.Options): string {
  return o.long
    ? `On your way: arriving in ${ticks(Math.max(0, o.long.ends - o.tick))}`
    : "You are there";
}
