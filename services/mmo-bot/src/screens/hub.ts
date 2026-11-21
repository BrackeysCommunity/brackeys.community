import type { Button } from "../../../../packages/discord-kit/src/index.ts";
import { buttonRows } from "../../../../packages/discord-kit/src/index.ts";
import * as api from "../api.ts";
import { type Card, COLOUR } from "../card.ts";
import { target } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, outOf, ticks } from "../units.ts";
import {
  back,
  banner,
  benchLine,
  btn,
  conditionsField,
  downButtons,
  factLine,
  gauges,
  launch,
  PRIVATE,
  stationLine,
  timeLeft,
} from "./common.ts";
import { dungeonName, floorOf } from "./dungeon.ts";

/** What testers are told before they start. */
export const TESTER_NOTE =
  "This is a test world. It stores your Discord user id, your character and what it does, and nothing else about you. Test worlds are wiped when the rules change; nothing here carries over. Full terms come before launch.";

/** /play before a character exists: one paragraph of arrival and the choice of three (GDD 3.1). */
export function startCard(lex: Lexicon): Card {
  return {
    context: "Only you can see this",
    author: "Arrival · a new character",
    title: "You come in off the ash road",
    description:
      "The gate of the settlement is a rusted cargo door on rollers. Someone hands you one thing to carry for the road, and asks which. Each starts at tier 1, level 1.",
    picture: "form",
    fields: [{ name: "Before you start", value: TESTER_NOTE }],
    footer: "The choice is yours to keep: the thing you carry levels with use.",
    rows: buttonRows(
      lex.starts.map((id) =>
        btn(`Take: ${lex.name("items.starts", id)}`, "start", id, 0, { style: "primary" }),
      ),
    ),
  };
}

/** The hub shows the current activity and available actions; hunt is a live hunt in reach. */
export function hubCard(
  o: api.Options,
  here: api.Here,
  sheet: api.Sheet,
  lex: Lexicon,
  notice?: string,
  hunt?: api.HuntCard,
): Card {
  const c = sheet.character;
  const doing = c.armed
    ? "Working a machine: its countdown is running"
    : o.long
      ? `${longLabel(o.long, lex)}: ${ticks(timeLeft(o))} to go`
      : o.fight
        ? "In an encounter"
        : "Free to act";
  const fields = [
    { name: "Coin", value: amount(c.coin, "coin"), inline: true },
    { name: "Provisions", value: amount(c.provisions, "provisions"), inline: true },
    { name: "Load", value: outOf(sheet.load.carried, sheet.load.capacity, "load"), inline: true },
    { name: "Doing", value: doing, inline: true },
    conditionsField(o),
    { name: "Region", value: gauges(here.place, lex) || "outside every region", inline: true },
  ];
  const v = o.version;
  const top: Button[] = [
    btn("Where I am", "where", "", v),
    btn("Travel", "travel", "", v),
    btn("Explore / Gather", "field", "", v),
    btn("Craft", "craft", "", v),
    btn("Party", "party", "", v),
  ];
  const second: Button[] = [
    btn("Market", "market", "orders", v),
    btn("Goals", "goals", "", v),
    btn("Guild", "guild", "", v),
    btn("Character", "character", "", v),
    btn("Chronicle", "recap", "", v),
  ];
  const urgent: Button[] = [];
  if (o.fight) urgent.push(btn("Back to the fight", "fight", "", v, { style: "danger" }));
  if ((o.fight?.machine && !o.fight.shared) || c.armed)
    urgent.push(launch("Work the machine", "hub", v));
  if (!o.fight && here.floor?.ways?.length)
    urgent.push(btn("To the fork", "dungeon", "", v, { style: "primary" }));
  if (hunt && !o.fight)
    urgent.push(btn(`Hunt: ${hunt.name}`, "hunt", hunt.id, v, { style: "danger" }));
  if (o.conditions.includes(api.CondDown)) urgent.push(...downButtons(o, v));
  if (o.long) urgent.push(btn("Stop", "cancel", "", v));
  return {
    context: PRIVATE,
    author: `Hub · ${here.name}`,
    title: notice ?? (o.fight ? "Something is in your way" : `You are at ${here.name}`),
    description: `${lex.name("map.terrain", here.place.tile.terrain)}${here.place.tile.weather ? `, under ${lex.name("world.weather", here.place.tile.weather).toLowerCase()}` : ""}.`,
    picture: banner(here, `: ${gauges(here.place, lex)}`),
    fields,
    footer: "The hub refreshes on your next press after 14 minutes.",
    rows: [...(urgent.length ? [{ buttons: urgent }] : []), { buttons: top }, { buttons: second }],
    colour: o.fight || o.conditions.includes(api.CondDown) ? COLOUR.rust : COLOUR.ash,
  };
}

function longLabel(l: api.Long, lex: Lexicon): string {
  switch (l.kind) {
    case "travel":
      return "Travelling";
    case "gather":
      return l.material === "provisions"
        ? "Foraging"
        : `Gathering ${lex.material(l.material ?? "")}`;
    case "rest":
      return "Resting";
    case "crawl":
      return "Crawling out";
    default:
      return l.kind;
  }
}

/** Where I am: banner, gauges, what is happening here, who is here (GDD 17.3). */
export function whereCard(o: api.Options, here: api.Here, lex: Lexicon): Card {
  const v = o.version;
  const recent =
    here.recent
      .slice(0, 5)
      .map((f) => `• ${factLine(f, lex)}`)
      .join("\n") || "Nothing heavy has happened here lately.";
  const people = here.people.slice(0, 4);
  const buttons: Button[] = people.map((p) =>
    btn(`Talk: ${p.name}${p.visit ? " (wants a word)" : ""}`, "talk", p.id, v),
  );
  const downed = here.downed.slice(0, 3);
  const floor = here.floor?.floor ?? 0;
  // One carry at a time, only of someone who called for help, and only on the rescuer's own floor.
  const lift = here.downed.find((d) => d.called && (d.floor ?? 0) === floor);
  if (lift && !o.rescue?.carrying)
    buttons.push(
      btn(
        lift.floor
          ? `Carry ${lift.name} up from ${floorOf(lift.floor, here.floor?.up)}`
          : `Carry ${lift.name} home`,
        "carry",
        lift.id,
        v,
        { style: "success" },
      ),
    );
  const more: Button[] = [];
  for (const t of here.trails.slice(0, 1))
    more.push(btn(`Follow the trail`, "follow", target(",", t.now.q, t.now.r), v));
  if (here.search) more.push(btn("Search the cache", "search", "", v, { style: "success" }));
  if (here.place.rest) more.push(btn("Rest", "rest", "", v));
  if (here.bench) more.push(launch("Work at the bench", "where", v));
  if (here.floor) more.push(btn("The dungeon", "dungeon", "", v));
  more.push(back(v));
  const overrun = here.place.overrun;
  const fields = [
    {
      name: "Gauges",
      value:
        gauges(here.place, lex, ["threat", "scarcity", "unrest", "corruption", "prosperity"]) ||
        "none",
    },
    { name: "What is happening here", value: recent },
  ];
  if (here.stations.length) {
    fields.push({
      name: "Stations",
      value: here.stations.map((s) => stationLine(s, lex)).join(", "),
    });
  }
  if (here.bench) fields.push({ name: "Tinker's bench", value: benchLine(here.bench) });
  if (people.length)
    fields.push({
      name: "People here",
      value: people.map((p) => `${p.name}, ${p.role}`).join("\n"),
    });
  if (downed.length)
    fields.push({
      name: "Down here",
      value: downed
        .map(
          (d) =>
            `${d.name}${d.floor ? `, on ${floorOf(d.floor, here.floor?.up)}` : ""}${d.called ? ", calling for help" : ""}`,
        )
        .join("\n"),
    });
  if (here.trails.length)
    fields.push({
      name: "Tracks",
      value: here.trails.map((t) => `someone passed ${ticks(t.ticks)} ago`).join("\n"),
    });
  if (here.floor) {
    const f = here.floor;
    const on = f.floor ? `You stand on ${floorOf(f.floor, f.up)}` : "You stand at its entrance";
    const deepest = f.deepest
      ? `; the deepest you have reached is ${floorOf(f.deepest, f.up)}`
      : "";
    fields.push({
      name: "Dungeon",
      value: `${dungeonName(f, lex).replace(/^./, (x) => x.toUpperCase())}. ${on}${deepest}. ${floorOf(f.floor || 1, f.up).replace(/^./, (x) => x.toUpperCase())} is ${here.dungeon === "cleared" ? "cleared; it refills in a few days" : "open"}.`,
    });
  } else if (here.dungeon)
    fields.push({
      name: "Dungeon",
      value:
        here.dungeon === "cleared"
          ? "Floor 1 is cleared; it refills in a few days. The way down is for parties."
          : "Floor 1 is open.",
    });
  return {
    context: PRIVATE,
    author: overrun
      ? "A region overrun"
      : `Where I am · ${lex.name("map.terrain", here.place.tile.terrain)}`,
    title: overrun ? `${here.name} is overrun` : here.name,
    description: overrun
      ? "Fire behind the wall. Nothing here is safe until threat falls."
      : undefined,
    picture: banner(here),
    fields,
    footer: "Every heavy fact on this tile is kept in its record.",
    rows: [...(buttons.length ? [{ buttons }] : []), ...buttonRows(more)],
    colour: overrun ? COLOUR.rust : COLOUR.ash,
  };
}

/** Since you left: the recap, a short list and then how many more (GDD 3.3). */
export function recapCard(
  o: api.Options,
  here: api.Here,
  recap: api.Recap,
  lex: Lexicon,
  people: Map<string, string>,
): Card {
  const lines = recap.lines.map((l) => {
    if (l.npc) return `• ${people.get(l.npc) ?? "Someone"} wants a word with you.`;
    return `• ${factLine(l.fact!, lex)}`;
  });
  if (recap.more) lines.push(`…and ${amount(recap.more, "more lines")}`);
  const away = Math.max(0, recap.tick - recap.since);
  return {
    context: PRIVATE,
    author: "Chronicle · since you left",
    title: lines.length ? "While you were away" : "Nothing moved that touched you",
    description:
      lines.join("\n") ||
      "The world ticked on. Prices, gauges and the road are where the hub shows them.",
    picture: banner(here),
    fields: [{ name: "Away for", value: ticks(away) }],
    footer: "What cost you comes first, then what paid you, then the world near you.",
    rows: [{ buttons: [back(o.version)] }],
  };
}
