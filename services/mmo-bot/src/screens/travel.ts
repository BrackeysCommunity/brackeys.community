import {
  type Button,
  type EmbedField,
  SELECT_LABEL_MAX,
} from "../../../../packages/discord-kit/src/index.ts";
import { mapAlt } from "../../../../packages/mmo-words/src/alt.ts";
import { seenAgo, sideName } from "../../../../packages/mmo-words/src/index.ts";
import type * as api from "../api.ts";
import { FogSeen, FogSight, WhyRoad } from "../api.ts";
import type { Card } from "../card.ts";
import { encodeId, target } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, plural, ticks } from "../units.ts";
import {
  back,
  btn,
  conditionsField,
  DIRECTIONS,
  PRIVATE,
  SELECT_MOST,
  timeLeft,
} from "./common.ts";
import { roadLine } from "./emergence.ts";

/** The most arc sides the go-to select offers before the sites seen. */
const SIDES_SHOWN = 5;

/** The map view and travel: a crop with fog and weather, six directions, go-to (GDD 6.1, 16.4). */
export function travelCard(
  o: api.Options,
  map: api.MapView,
  here: api.Here,
  lex: Lexicon,
  threatLine: number,
  risk?: api.RouteRisk,
): Card {
  const v = o.version;
  const view = map.view ?? [];
  const byHex = new Map(view.map((t) => [target(",", t.cell.q, t.cell.r), t]));
  const moves = DIRECTIONS.map((d, i) => {
    const m = o.moves.find((x) => x.dir === i);
    const label = m?.open
      ? `${d.arrow} ${d.name} · ${plural(m.ticks, "tick")}${roadMark(m, byHex.get(target(",", m.to.q, m.to.r)))}`
      : `${d.arrow} ${d.name}`;
    return btn(label, "step", String(i), v, {
      disabled: !m?.open || !!o.long || !!o.fight,
      style: here.suggest?.dir === i ? "primary" : "secondary",
    });
  });
  // Where an arc's sides are served comes first: goods land there and beats count round it.
  const destinations = new Map<string, string>();
  for (const sd of o.sides ?? []) {
    if (sd.at.q === o.at.q && sd.at.r === o.at.r) continue;
    const label = `To back ${sideName(sd.side, lex).toLowerCase()}${sd.region ? `, in ${sd.region}` : ""}`;
    const key = target(",", sd.at.q, sd.at.r);
    if (!destinations.has(key) && destinations.size < SIDES_SHOWN)
      destinations.set(key, label.slice(0, SELECT_LABEL_MAX));
  }
  for (const t of map.tiles) {
    if (!t.site || (t.hex.q === map.centre.q && t.hex.r === map.centre.r)) continue;
    const key = target(",", t.hex.q, t.hex.r);
    if (!destinations.has(key) && destinations.size < SELECT_MOST)
      destinations.set(key, siteLabel(t, lex));
  }
  const rows: Card["rows"] = [{ buttons: moves.slice(0, 3) }, { buttons: moves.slice(3) }];
  if (destinations.size && !o.long && !o.fight) {
    rows.push({
      select: {
        customId: encodeId("goto", "", v),
        placeholder: "Go to a place you have seen…",
        options: [...destinations].map(([value, label]) => ({ label, value })),
      },
    });
  }
  const tail: Button[] = [btn("Why these costs", "why", "moves", v)];
  if (o.long?.kind === "travel") tail.push(btn("Stop here", "cancel", "", v, { style: "danger" }));
  tail.push(back(v));
  rows.push({ buttons: tail });
  const seen = view.filter((t) => t.fog === FogSeen);
  const fields: EmbedField[] = [
    {
      name: "Here",
      value: `${here.name}, ${lex.name("map.terrain", here.place.tile.terrain).toLowerCase()}`,
      inline: true,
    },
    conditionsField(o),
    {
      name: "In sight",
      value: plural(view.filter((t) => t.fog === FogSight).length, "tile"),
      inline: true,
    },
    { name: "Last seen", value: lastSeen(map, seen), inline: true },
  ];
  const road = roadLine(here.place.tile, lex);
  if (road) fields.push({ name: "The road", value: road });
  if (here.suggest && !o.long) {
    const d = DIRECTIONS[here.suggest.dir]!;
    fields.push({
      name: "A first outing",
      value: `A site to explore ${plural(here.suggest.tiles, "tile")} away: start ${d.arrow} ${d.name}.`,
    });
  }
  if (o.long?.kind === "travel") {
    fields.push({
      name: "On the road",
      value: `${amount(o.long.route?.length ?? 0, "tiles")} left, arriving in ${ticks(timeLeft(o))}`,
    });
  }
  if (risk)
    fields.push(
      riskField(
        risk,
        o.long?.kind === "travel"
          ? "this road"
          : risk.to
            ? `the road to ${risk.to}`
            : "the road to market",
      ),
    );
  return {
    context: PRIVATE,
    author: o.long?.kind === "travel" ? "Travel · on the road" : "Travel · the map",
    title: o.long?.kind === "travel" ? "On the road" : "Which way?",
    description: `A step takes ${lex.numbers.stepMin} to ${plural(lex.numbers.stepMax, "tick")} a tile by the ground. A journey of more than ${ticks(lex.numbers.freeTicks)} eats provisions; it runs on while you are away, and stops before a region at ${amount(threatLine, "threat")} or more. Running out of provisions makes you hungry, not stuck.`,
    picture: {
      media: map.image,
      alt: mapAlt({
        of: here.name,
        radius: map.radius,
        shaded: ["fog over what nobody has entered", "weather", "threat"],
        seen: seen.length,
      }),
    },
    fields,
    footer: "Each tile entered is a fact: the recap tells where the journey went.",
    rows,
    modifiers: true,
  };
}

/** What a step's button adds for a road: on it, tolled or cut. A toll or a cut shows only in sight. */
function roadMark(m: api.Move, to: api.MapTileView | undefined): string {
  const live = to?.fog === FogSight ? to.live : undefined;
  if (m.why.parts.some((p) => p.label === WhyRoad))
    return live?.toll ? ` · road, ${amount(live.toll, "coin")} toll` : " · road";
  return to?.cell.roadName && live?.cut ? " · road cut" : "";
}

/** How many tiles the crop draws as last seen, and how long ago the oldest left sight. */
function lastSeen(map: api.MapView, seen: readonly api.MapTileView[]): string {
  if (!seen.length) return plural(0, "tile");
  const oldest = Math.min(...seen.map((t) => t.live?.left ?? map.tick));
  return `${plural(seen.length, "tile")}, the oldest ${seenAgo(map.tick, oldest)}`;
}

/** A seen place as the go-to select names it: its slot, its kind once drawn, and its ground. */
function siteLabel(t: api.Tile, lex: Lexicon): string {
  const kind = t.siteKind ? `, ${lex.name("map.site-kinds", t.siteKind).toLowerCase()}` : "";
  const road = t.roadName ? `, on ${t.roadName}` : "";
  return `${lex.name("map.landmarks", t.site!)}${kind} (${lex.name("map.terrain", t.terrain)}${road})`.slice(
    0,
    SELECT_LABEL_MAX,
  );
}

/** A route's danger and the haul it puts at risk (GDD 10.7), as a field for the travel card. */
export function riskField(r: api.RouteRisk, road: string): { name: string; value: string } {
  return {
    name: `Route risk on ${road}`,
    value: r.tiles.length
      ? `Worst odds of an ambush: ${r.worst}, over ${plural(r.tiles.length, "tile")}; expect ${(r.expected / 100).toFixed(1)} ambushes. Lost, your haul costs ${amount(r.haul, "coin")}.`
      : `No ambush ground on the way; your haul is worth ${amount(r.haul, "coin")}.`,
  };
}
