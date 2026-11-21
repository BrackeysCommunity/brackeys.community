import {
  type Button,
  buttonRows,
  type EmbedField,
  type Modal,
} from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { encodeId } from "../ids.ts";
import { capitalise, type Lexicon } from "../lexicon.ts";
import { amount, plural } from "../units.ts";
import { back, banner, btn, factNum, goodsLine, PRIVATE, relative } from "./common.ts";

/**
 * A dungeon's cards (GDD 4.9): its entrance, a fork with its ways, the
 * choice made there, and the bottom with its naming. A card shows the
 * floor and the deepest floor reached, never how many floors there are;
 * a way's next floor only to a Mapper.
 */

/** A relay tower's floors go up and are called levels. */
export function floorWord(up?: boolean): string {
  return up ? "level" : "floor";
}

/** "floor 3", or "level 3" in a relay tower. */
export function floorOf(n: number, up?: boolean): string {
  return `${floorWord(up)} ${n}`;
}

/** A dungeon's given name, or its kind's while it has none. */
export function dungeonName(d: { name?: string; kind: string }, lex: Lexicon): string {
  return d.name || `the ${lex.name("map.dungeons", d.kind).toLowerCase()}`;
}

const LETTERS = ["A", "B", "C"];

/** A way's letter and name, as its button and its line read. */
export function wayLabel(w: api.WayView, ways: readonly api.WayView[]): string {
  return `${LETTERS[ways.indexOf(w)] ?? "?"}. ${w.name}`;
}

/** Tags as words. */
export function tagWords(tags: readonly string[]): string {
  return tags.map((t) => t.replace(/-/g, " ")).join(", ") || "no tags";
}

/** One way's line: its tags, whether it stands open, its votes, and what a Mapper reads past it. */
function wayLine(w: api.WayView, lex: Lexicon, up?: boolean): string {
  const state = w.open
    ? "open"
    : w.machine
      ? `behind ${lex.name("puzzles.families", w.machine)}, a machine the party works in the Activity`
      : "closed";
  const parts = [tagWords(w.tags), state, plural(w.votes, "vote")];
  if (w.next?.length) {
    const creature = w.next.at(-1)!;
    const tags = w.next.slice(0, -1);
    parts.push(
      `the next ${floorWord(up)}: ${tagWords(tags)}, against ${lex.name("creatures.archetypes", creature).toLowerCase()} (Mapper)`,
    );
  }
  return parts.join(" · ");
}

/** Whether the viewer is among a dungeon's first slayers and it has no name yet, by the tile's facts. */
export function mayName(
  f: api.FloorView | undefined,
  facts: readonly api.Fact[],
  me: string,
): boolean {
  if (!f || f.name) return false;
  const here = (x: api.Fact) => !x.data.some((d) => d.k === "q") || factHex(x) === f.dungeon;
  if (facts.some((x) => x.kind === "dungeon.named" && here(x))) return false;
  return facts.some(
    (x) =>
      x.kind === "dungeon.slain-first" &&
      here(x) &&
      x.subjects.some((s) => s.kind === "character" && s.id === me),
  );
}

function nameButton(f: api.FloorView, v: number): Button {
  return btn("Name the dungeon", "d-name", f.dungeon, v, { style: "success" });
}

function poolLine(f: api.FloorView, lex: Lexicon): string | undefined {
  if (!f.pool?.length) return undefined;
  return goodsLine(f.pool, lex);
}

/** The dungeon's entrance: its kind and name, the deepest floor reached, who is down inside, and the way in. */
export function entranceCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  me: string,
  notice?: string,
): Card {
  const f = here.floor!;
  const v = o.version;
  const word = floorWord(f.up);
  const fields: EmbedField[] = [
    {
      name: "Deepest you have reached",
      value: f.deepest ? floorOf(f.deepest, f.up) : `not past the entrance yet`,
      inline: true,
    },
    {
      name: "You stand",
      value: f.floor ? `on ${floorOf(f.floor, f.up)}` : "at the entrance",
      inline: true,
    },
    { name: "Kind", value: lex.name("map.dungeons", f.kind), inline: true },
  ];
  if (f.haunted)
    fields.push({
      name: "Haunted",
      value:
        "Too many have fallen here lately: shaken lasts longer, and what fell is found more often.",
    });
  if (f.downed?.length) fields.push({ name: `Down on this ${word}`, value: f.downed.join(", ") });
  const pool = poolLine(f, lex);
  if (pool) fields.push({ name: "What fell below (Hoard sense)", value: pool });
  const buttons: Button[] = [];
  if (f.ways?.length && !o.fight)
    buttons.push(btn("To the fork", "dungeon", "", v, { style: "primary" }));
  else if (o.explore && !f.floor)
    buttons.push(
      btn(`Enter ${floorOf(1, f.up)}`, "explore", "", v, {
        style: "primary",
        disabled: !!o.long || !!o.fight,
      }),
    );
  if (mayName(f, here.recent, me)) buttons.push(nameButton(f, v));
  buttons.push(btn("Party", "party", "", v), back(v));
  return {
    context: PRIVATE,
    author: authorLine(
      "Dungeon",
      lex.name("map.dungeons", f.kind),
      f.floor ? floorOf(f.floor, f.up) : "the entrance",
    ),
    title: notice ?? capitalise(dungeonName(f, lex)),
    description: f.up
      ? `A relay tower. Its ${word}s go up, each half a tier harder than the one below, and its guardian waits at the top.`
      : `Its ${word}s go down, each half a tier harder than the one above, and its guardian waits at the bottom.`,
    picture: banner(here, `; the way into ${dungeonName(f, lex)}`),
    fields,
    footer: "A party goes in together: everyone on the tile when it starts shares the encounter.",
    rows: [{ buttons }],
    colour: f.haunted ? COLOUR.corrupt : COLOUR.ash,
  };
}

/** A fork: the floor cleared, the ways down with their tags and votes, and push or leave. */
export function forkCard(o: api.Options, here: api.Here, lex: Lexicon, notice?: string): Card {
  const f = here.floor!;
  const v = o.version;
  const ways = f.ways ?? [];
  const open = ways.filter((w) => w.open);
  const fields: EmbedField[] = ways.map((w) => ({
    name: wayLabel(w, ways),
    value: wayLine(w, lex, f.up),
  }));
  fields.push({ name: "Deepest you have reached", value: floorOf(f.deepest, f.up), inline: true });
  if (f.due)
    fields.push({
      name: "Time left",
      value: `${relative(f.due)}; whoever has not chosen then takes the default`,
      inline: true,
    });
  if (f.choices?.length) fields.push({ name: "Chosen so far", value: choiceLines(f, ways) });
  const pool = poolLine(f, lex);
  if (pool) fields.push({ name: "What fell below (Hoard sense)", value: pool });
  const buttons: Button[] = open.map((w) =>
    btn(`Push: ${wayLabel(w, ways)}`, "push", w.id, v, { style: "primary" }),
  );
  if (ways.some((w) => w.machine && !w.open))
    buttons.push(btn("The machine on the way", "p-machine", "fork", v, { style: "success" }));
  buttons.push(btn("Leave with the haul", "dg-leave", "", v));
  return {
    context: PRIVATE,
    author: authorLine("Dungeon", floorOf(f.floor, f.up), "the fork"),
    title:
      notice ?? `${capitalise(floorOf(f.floor, f.up))} cleared: ${plural(ways.length, "way")} down`,
    description:
      "Push on, naming a way, or leave with what you carry. Only those who push vote; a tie goes to the leader's way. Whoever does nothing leaves.",
    picture: banner(here, `; ${plural(ways.length, "way")} down from ${floorOf(f.floor, f.up)}`),
    fields,
    footer: `Going down puts what you carry at risk on the next ${floorWord(f.up)}. Leaving climbs out in a tick.`,
    rows: [...buttonRows(buttons), { buttons: [btn("Party", "party", "", v), back(v)] }],
    colour: COLOUR.hazard,
  };
}

function choiceLines(f: api.FloorView, ways: readonly api.WayView[]): string {
  return (f.choices ?? [])
    .map((c) => {
      const w = ways.find((x) => x.id === c.way);
      return `${c.name}: ${c.push ? `pushes down ${w ? wayLabel(w, ways) : "a way"}` : "leaves"}`;
    })
    .join("\n");
}

/** Push or leave: what the viewer chose at the fork, everyone's choices, and the time left. */
export function pushLeaveCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  mine: api.ChoiceView,
  waiting: number,
): Card {
  const f = here.floor!;
  const v = o.version;
  const ways = f.ways ?? [];
  const way = ways.find((w) => w.id === mine.way);
  const fields: EmbedField[] = [
    { name: "Chosen so far", value: choiceLines(f, ways) || "only you" },
  ];
  fields.push({
    name: "Votes",
    value: ways.map((w) => `${wayLabel(w, ways)}: ${plural(w.votes, "vote")}`).join("\n"),
    inline: true,
  });
  fields.push({
    name: "Waiting on",
    value: waiting ? plural(waiting, "member") : "nobody: it resolves now",
    inline: true,
  });
  if (f.due) fields.push({ name: "Time left", value: relative(f.due), inline: true });
  return {
    context: PRIVATE,
    author: authorLine("Dungeon", floorOf(f.floor, f.up), mine.push ? "pushing on" : "leaving"),
    title: mine.push
      ? `You push down ${way ? wayLabel(way, ways) : "a way"}`
      : "You leave with what you carry",
    description: mine.push
      ? "The way with the most votes is taken once everyone present has chosen or the time runs out."
      : "You climb out once the fork resolves; the rest go down as a smaller party.",
    picture: banner(here, `; the fork on ${floorOf(f.floor, f.up)}`),
    fields,
    footer: "Choices at a fork are open: everyone sees who pushes where.",
    rows: [{ buttons: [btn("Party", "party", "", v), back(v)] }],
    colour: COLOUR.hazard,
  };
}

/** The bottom: the guardian slain, its spoils, and the naming for the first to slay it. */
export function bottomCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  facts: readonly api.Fact[],
  me: string,
): Card {
  const v = o.version;
  const f = here.floor;
  const slain = facts.find((x) => x.kind === "guardian.slain");
  const first = facts.some(
    (x) =>
      x.kind === "dungeon.slain-first" &&
      x.subjects.some((s) => s.kind === "character" && s.id === me),
  );
  const rolled = (slain?.data ?? [])
    .filter((d) => d.k.startsWith("rolled:"))
    .map((d) => amount(d.n ?? 0, lex.material(d.k.slice("rolled:".length))));
  const fields: EmbedField[] = [];
  if (rolled.length)
    fields.push({ name: "The guardian's spoils, rolled once", value: rolled.join(", ") });
  if (slain)
    fields.push({
      name: "Hunters",
      value: plural(slain.subjects.filter((s) => s.kind === "character").length, "member"),
      inline: true,
    });
  const buttons: Button[] = [];
  if (f && first && !f.name) buttons.push(nameButton(f, v));
  buttons.push(btn("Party", "party", "", v), back(v));
  const name = f ? dungeonName(f, lex) : "the dungeon";
  return {
    context: PRIVATE,
    author: authorLine("Dungeon", "the bottom", slain ? "its guardian slain" : "reached"),
    title: slain ? `The guardian of ${name} is slain` : `The bottom of ${name}`,
    description: first
      ? "Yours was the first party to slay it: its leader names the dungeon, once and for good."
      : "The spoils were split by what each of you did; you climb back to the entrance.",
    picture: banner(here, `; the bottom of ${name}`),
    fields,
    footer: "A dungeon left unnamed for a day after its first kill takes a name of its own.",
    rows: [{ buttons }],
    colour: COLOUR.signal,
  };
}

/** The naming modal: the first slayers' leader names the dungeon. */
export function dungeonNameModal(dungeon: string, version: number): Modal {
  return {
    customId: encodeId("d-named", dungeon, version),
    title: "Name the dungeon",
    inputs: [{ id: "name", label: "Name", max: 40, required: true }],
  };
}

/** Whether a press's facts show the bottom reached: the guardian slain, or the last floor cleared and climbed from. */
export function reachedBottom(facts: readonly api.Fact[]): boolean {
  return facts.some((x) => x.kind === "guardian.slain" || x.kind === "dungeon.slain-first");
}

/** The tile a fact names, as a dungeon's "q,r" reference. */
export function factHex(f: api.Fact): string {
  return `${factNum(f, "q")},${factNum(f, "r")}`;
}
