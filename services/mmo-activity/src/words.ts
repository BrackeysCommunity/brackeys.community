import { names } from "virtual:pack";

import { clampAlt as clamp } from "../../../packages/mmo-words/src/alt.ts";
import { encounterLine, WASTELAND_ENCOUNTERS } from "../../../packages/mmo-words/src/encounters.ts";
import { clueLine as storyClue } from "../../../packages/mmo-words/src/story.ts";
import { capital, countWords, list } from "../../../packages/mmo-words/src/units.ts";
import {
  UnitBeats,
  UnitEncounter,
  type ActivityState,
  type Fact,
  type Fight,
  type FloorView,
  type Goods,
  type HaywireLine,
  type Part,
  type PracticeLine,
  type PuzzleResult,
  type Reason,
  type Refusal,
  type Theft,
  type Tile,
  TheftBurgle,
  TheftFlee,
  TheftWaylay,
} from "./api.ts";
import {
  adds,
  amount,
  level,
  num,
  outOf,
  percent,
  plural,
  quantity,
  seconds,
  signed,
  stopwatch,
  uses,
} from "./units.ts";

export { capital as sentence };
export { riskLine } from "../../../packages/mmo-words/src/risk.ts";
export { placedLine } from "../../../packages/mmo-words/src/placed.ts";
export { heldLine, patternKind } from "../../../packages/mmo-words/src/story.ts";

/**
 * Names a state carries, "sheet:id" to name, for what the world found
 * after the pack was built: a found material.
 */
export type Found = Record<string, string> | undefined;

/**
 * What the pack calls a row, or what the state names it where the pack
 * cannot know it; an id neither names is shown as written.
 */
export function name(sheet: string, id: string, found?: Found): string {
  const ref = `${sheet}:${id}`;
  return found?.[ref] ?? names[ref] ?? capital(id.replace(/-/g, " "));
}

/** Whether the pack names a row of a sheet. */
export function named(sheet: string, id: string): boolean {
  return `${sheet}:${id}` in names;
}

/** A practice as one phrase: "level 3, Wirewright, 12 of 60 uses to the next". */
export function practiceLine(p: PracticeLine, title = true): string {
  return `${level(p.level)}${title && p.title ? `, ${p.title}` : ""}, ${uses(p.uses, p.need)} to the next`;
}

/** Every good's name in lower case, found ones included, for the bare-number rule. */
export function goodsNames(found?: Found): Set<string> {
  const out = new Set<string>();
  for (const [ref, n] of [...Object.entries(names), ...Object.entries(found ?? {})])
    if (ref.startsWith("items.materials:")) out.add(n.toLowerCase());
  return out;
}

export function goodsLine(goods: Goods[], found?: Found): string {
  if (goods.length === 0) return "nothing";
  return goods
    .map((g) => amount(g.units, name("items.materials", g.material, found).toLowerCase()))
    .join(", ");
}

/** The named road a tile is on, and whether it is cut or tolled today; "" off a road. */
export function roadLine(t: Pick<Tile, "roadName" | "cut" | "toll">): string {
  if (!t.roadName) return "";
  if (t.cut) return `On ${t.roadName}, cut: it is no faster than the land`;
  if (t.toll) return `On ${t.roadName}, tolled: ${amount(t.toll, "coin")} a crossing`;
  return `On ${t.roadName}`;
}

/**
 * The band steps a region's adaptation took off an option (GDD 13.2), in
 * words: a step is not a unit the bare-number rule knows.
 */
export function adaptedLine(steps: number): string {
  return `The creatures here have adapted against it: ${countWords(Math.abs(Math.trunc(steps)), "band")} worse`;
}

function state(h: HaywireLine): string {
  return (h.tag ? name("fights.states", h.tag) : h.name).toLowerCase();
}

/** What a machine does when it fails, in one line. */
export function haywireLine(h: HaywireLine): string {
  const title = capital(h.name);
  switch (h.unit) {
    case "durability":
      return `${title}: ${amount(h.magnitude, "durability")} off the item in your hand`;
    case "gauge":
      return `${title}: ${adds(h.magnitude, "threat")} in the region`;
    case "days":
      return `${title}: shut to you for ${plural(h.magnitude, "world day")}`;
    case UnitEncounter:
      return `${title}: you are ${state(h)} for the rest of the encounter`;
    case UnitBeats:
      return `${title}: you are ${state(h)} for ${plural(h.magnitude, "beat")}`;
    default:
      return `${title}: ${quantity(h.magnitude, h.unit)}`;
  }
}

const REASONS: Record<string, string> = {
  family: "This kind of machine",
  level: "Its level",
  tier: "The creature's tier",
  practice: "Your practice",
  party: "Worked as a party",
};

/** One line of a machine's why: what it is, and what it adds to the countdown. */
export function reasonLine(r: Reason, first: boolean): string {
  const label = REASONS[r.label] ?? capital(r.label.replace(/-/g, " "));
  return `${label}: ${first ? quantity(r.value, r.unit) : adds(r.value, r.unit)}`;
}

const REFUSALS: Record<string, string> = {
  "no-machine": "There is no machine here to work any more.",
  "machine-armed": "A machine's countdown is running. Finish it first.",
  "locked-down": "This machine has locked you out for now.",
  "no-lesson": "There is no lesson to take here today.",
  "needs-activity": "That one is a machine. Open it here to work it.",
  stale: "The world moved on. This is how things stand now.",
  busy: "Too many presses at once. Try again in a moment.",
  down: "You are down and cannot act.",
};

/** Why the world turned a press down. Its own message says the rule when the code is not one of ours. */
export function refusalLine(r: Refusal): string {
  return REFUSALS[r.code] ?? r.message;
}

function datum(f: Fact, key: string): number | string | undefined {
  const d = f.data.find((x) => x.k === key);
  return d?.s ?? d?.n;
}

/**
 * A fact as one line, for the kinds a machine or a theft writes. Any other
 * kind is named without its numbers, since their units are not known here.
 */
export function factLine(f: Fact): string {
  const family = datum(f, "family");
  const machine = typeof family === "string" ? name("puzzles.families", family) : "The machine";
  const n = (key: string) => Number(datum(f, key) ?? 0);
  switch (f.kind) {
    case "machine.armed":
      return `${machine} armed.`;
    case "machine.moved-on":
      return `${machine} solved, but the fight had moved on: nothing came of it.`;
    case "puzzle.solved":
      return `${machine} solved in ${stopwatch(n("ms"))}.`;
    case "puzzle.haywire":
      return n("late")
        ? `${machine} went haywire: the countdown ran out.`
        : `${machine} went haywire.`;
    case "puzzle.mastered":
      return `${machine} mastered.`;
    case "practice.levelled":
      return `Practice rose to ${quantity(n("level"), "level")}.`;
    case "bench.solved":
      return n("uses") > 0
        ? `Bench solve: ${signed(n("uses"), n("uses") === 1 ? "use" : "uses")} of practice.`
        : "Bench solve: today's bench practice is used up.";
    case "lesson.taken":
      return `Lesson taken in ${machine}.`;
    case "pouch.opened":
      return `Pouch opened: ${amount(n("goods"), "goods")}.`;
    case "pouch.found":
      return "A locked pouch found.";
    case "pattern.set": {
      const set = `Point ${pointName(n("point"))} of the pattern now holds ${valueTag(n("value"))}.`;
      return datum(f, "reach") === undefined ? set : `${set} ${reachLine(n("reach"))}`;
    }
    case "pattern.haywire":
      return `The pattern answered wrong: ${adds(n("threat"), "threat")} surged around it.`;
    case "pattern.solved":
      return "The pattern is solved.";
    case "pattern.clue":
      return `Clue found: ${clueLine(f)}`;
    default:
      return crimeLine(f) ?? `${capital(f.kind.replace(/[.-]/g, " "))}.`;
  }
}

// structural: the syndicate's standing key and archetype row.
const SYNDICATE = "syndicate";

// What a theft took, from its fact's data; an item is named only as one,
// since a fact holds its id.
function takenLine(f: Fact): string {
  const n = (key: string) => Number(datum(f, key) ?? 0);
  const material = datum(f, "material");
  const item = datum(f, "item");
  const parts = [
    n("coin") > 0 ? amount(n("coin"), "coin") : "",
    n("units") > 0 && typeof material === "string" && material
      ? amount(n("units"), name("items.materials", material).toLowerCase())
      : "",
    typeof item === "string" && item ? "an item" : "",
  ].filter(Boolean);
  return parts.length ? list(parts) : "nothing";
}

// The lines for theft, the watch and the syndicate (GDD 4.5, 5.10, 6.5),
// or undefined for any other kind.
function crimeLine(f: Fact): string | undefined {
  const n = (key: string) => Number(datum(f, key) ?? 0);
  const has = (key: string) => datum(f, key) !== undefined;
  const syndicate = name("factions.archetypes", SYNDICATE);
  switch (f.kind) {
    case "theft.made": {
      const kind = name("theft.kinds", String(datum(f, "kind") ?? ""));
      switch (datum(f, "outcome")) {
        case "lost":
          return `${kind}: you were caught, and took nothing.`;
        case "empty":
          return `${kind}: what you were after was gone, and nothing came of it.`;
        default: {
          const coinOnly = n("worth") === n("coin");
          const worth = n("worth") > 0 && !coinOnly ? `, worth ${amount(n("worth"), "coin")}` : "";
          const seen = n("witnessed") ? "You were seen." : "No one saw you.";
          return datum(f, "side")
            ? `${kind}: ${takenLine(f)}${worth}, for the side you back. ${seen}`
            : `${kind}: you got away with ${takenLine(f)}${worth}. ${seen}`;
        }
      }
    }
    case "alignment.moved": {
      const band = datum(f, "band");
      const named = typeof band === "string" && band ? `, ${name("alignment.bands", band)}` : "";
      return `Alignment ${signed(n("delta"), "alignment")}: now ${amount(n("value"), "alignment")}${named}.`;
    }
    case "watch.stopped":
      return "The watch stopped you at the gate: pay the fine or run.";
    case "watch.paid":
      return has("fine")
        ? `You paid the watch off: ${amount(n("fine"), "coin")}.`
        : "You paid the watch off.";
    case "watch.fled":
      return "You got away from the watch.";
    case "watch.caught":
      return "The watch caught you, and took the goods back.";
    case "fence.bought":
      return has("pay")
        ? `The fence bought the goods for ${amount(n("pay"), "coin")}.`
        : "The fence bought the goods.";
    case "fence.came":
      return "A fence has come looking for you.";
    case "craft.laundered":
      return has("fee")
        ? `Worked clean in the back room, for ${amount(n("fee"), "coin")} in fees.`
        : "Worked clean in the back room.";
    case "syndicate.made":
      return `${syndicate} has made you one of its own.`;
    case "syndicate.unmade":
      return `${syndicate} has cast you out.`;
    case "syndicate.posted":
      return `${syndicate} has posted a job for its own.`;
    case "character.betrayed": {
      const who = datum(f, "faction") === SYNDICATE ? syndicate : "a faction that trusted you";
      return has("standing")
        ? `You betrayed ${who}: your standing with it is ${amount(n("standing"), "standing")}.`
        : `You betrayed ${who}.`;
    }
    case "den.moved":
      return `A den of ${syndicate} has moved.`;
  }
  return undefined;
}

const WITNESS_PARTS: Record<string, string> = {
  base: "This kind of theft",
  upright: "Upright people here",
  sleight: "Your Sleight",
  cover: "Cover here",
  quiet: "Quiet gear in hand",
};

/** One part of a theft's witness odds: what it adds, in per cent unless the part names another unit. */
export function witnessPartLine(p: Part): string {
  const label = WITNESS_PARTS[p.label] ?? capital(p.label.replace(/-/g, " "));
  const unit = !p.unit || p.unit === "%" ? "percent" : p.unit;
  return `${label}: ${adds(p.value, unit)}`;
}

/** A theft's title: its kind, and whom it is from. */
export function theftTitle(t: Theft): string {
  return `${name("theft.kinds", t.kind)}: ${t.victim}`;
}

// What a theft is after, as planned when it began.
function haulLine(t: Theft, found?: Found): string {
  const parts = [
    t.coin ? amount(t.coin, "coin") : "",
    t.haul?.length ? goodsLine(t.haul, found) : "",
    t.item ?? "",
  ].filter(Boolean);
  const what = parts.length ? list(parts) : "what is there";
  return t.worth > 0 ? `${what}, worth ${amount(t.worth, "coin")}` : what;
}

/** What a theft is after and from whom; a flight says whom it runs from. */
export function theftLine(t: Theft, found?: Found): string {
  if (t.kind === TheftFlee) return `Running from the watch at ${t.victim}.`;
  const verb =
    t.kind === TheftWaylay ? "Waylaying" : t.kind === TheftBurgle ? "Burgling" : "Lifting from";
  const side = t.forSide ? " The haul goes to the side you back." : "";
  return `${verb} ${t.victim}: ${haulLine(t, found)}.${side}`;
}

/**
 * The chance a theft is seen if it works, as the world fixed it when the
 * theft began (GDD 6.5); "" for a flight, which nobody witnesses.
 */
export function witnessLine(t: Theft): string {
  if (t.kind === TheftFlee) return "";
  if (t.witness >= 100) return `Witness: always seen (${percent(t.witness)}).`;
  return `Witness: ${percent(t.witness)} to be seen if it works.`;
}

/** What a failed beat has made of a theft: caught, with only the getaway left. */
export function caughtLine(t: Theft): string {
  if (!t.caught) return "";
  return t.kind === TheftFlee
    ? "The watch has you if this goes wrong again."
    : "You were caught: there is no haul now, only the getaway.";
}

/** The beat track's words on a theft: what it is and from whom, in place of a creature. */
export function theftAlt(f: Fight, t: Theft): string {
  const kind = name("fights.beats", f.kind).toLowerCase();
  return clamp(
    `${theftTitle(t)}, a ${kind}: beat ${outOf(f.beat + 1, f.beats, f.beats === 1 ? "beat" : "beats")}.`,
  );
}

/** What a move log became, as the server answered it. */
export function resultLine(r: PuzzleResult, bench: boolean): string {
  if (r.master) return `Solved, and the hidden panel with it, in ${stopwatch(r.at)}.`;
  if (r.clean) return `A clean solve, in ${stopwatch(r.at)}.`;
  if (r.solved) return `Solved in ${stopwatch(r.at)}.`;
  if (bench) return "Not solved. The bench sets up another.";
  if (r.late) return "The countdown ran out.";
  return "The machine went haywire.";
}

/** A countdown as its ruler reads: "34 s left". */
export function leftLine(ms: number): string {
  return `${seconds(ms)} left`;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * A pattern's point by letter, A for the first, as its clues name them. A
 * letter keeps a point's index from reading as a count.
 */
export function pointName(i: number): string {
  let out = "";
  for (let k = Math.max(0, Math.trunc(i)) + 1; k > 0; k = Math.trunc((k - 1) / LETTERS.length))
    out = LETTERS[(k - 1) % LETTERS.length] + out;
  return out;
}

/** A point's value as chat's pattern-set takes it: a setting or a facing, "#2". */
export function valueTag(v: number): string {
  return `#${num(v)}`;
}

// How far an alignment's signal leads from the first point.
function reachLine(reach: number): string {
  return reach > 0
    ? `The signal runs from point A to point ${pointName(reach - 1)}.`
    : "The signal stops at point A.";
}

/** What a pattern.clue fact says, in the board's point letters. */
export function clueLine(f: Fact): string {
  return `${capital(storyClue(f, (i) => `point ${pointName(i)}`))}.`;
}

/** The creature a fight is against: a region's variant by its own name (GDD 4.17). */
export function creatureName(f: Pick<Fight, "creature" | "creatureName">): string {
  return f.creatureName || name("creatures.archetypes", f.creature);
}

/** A dungeon as a line names it mid-sentence: its given name, else "the bunker". */
export function dungeonPlace(d: Pick<FloorView, "name" | "kind">): string {
  return d.name || `the ${name("map.dungeons", d.kind).toLowerCase()}`;
}

/**
 * The place a beat's encounter line names, as the bot's card names it: a
 * party's beat on a dungeon floor is in the dungeon, any other in the
 * place the character stands.
 */
export function beatPlace(st: Pick<ActivityState, "fight" | "floor" | "place">): string {
  const f = st.fight;
  if (f?.shared && f.floor && st.floor) return dungeonPlace(st.floor);
  return st.place.name ?? "";
}

/** The beat's opening line from the encounter pool, the same pick the bot's card makes; "" when none fits. */
export function beatLine(st: Pick<ActivityState, "fight" | "floor" | "place">): string {
  const f = st.fight;
  if (!f) return "";
  return encounterLine(WASTELAND_ENCOUNTERS, f, {
    creature: creatureName(f),
    place: beatPlace(st),
  });
}

/** The beat track beside a creature, in words: who it is, the beat, and what the fight says of it. */
export function creatureAlt(f: Fight): string {
  const kind = name("fights.beats", f.kind).toLowerCase();
  const variant = f.creatureName
    ? `, a ${name("creatures.archetypes", f.creature).toLowerCase()} of this region`
    : "";
  return clamp(
    [
      `${creatureName(f)}${variant}, in a ${kind}: beat ${outOf(f.beat + 1, f.beats, f.beats === 1 ? "beat" : "beats")}.`,
      f.hidden ? "It has not seen you." : "",
      f.ambush ? "It is an ambush." : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Where a machine is in its play, as its drawing is described. */
export type MachineState =
  | "rest"
  | "locked"
  | "bench"
  | "armed"
  | "working"
  | "hidden-panel"
  | "sending"
  | "done";

const MACHINE_STATES: Record<MachineState, string> = {
  rest: "at rest: the first touch arms it",
  locked: "locked: it has locked you out for now",
  bench: "a practice rig on the bench, with no countdown",
  armed: "armed, its countdown running",
  working: "being worked on the bench",
  "hidden-panel": "solved, its hidden panel open",
  sending: "its moves on their way to the world",
  done: "answered by the world",
};

/**
 * A machine's drawing in words: which machine, its level, where it is in
 * its play, then what the scene itself shows.
 */
export function machineAlt(
  m: { name: string; family: string; level?: number },
  state: MachineState,
  scene: string,
): string {
  const known = m.name || name("puzzles.families", m.family);
  const head = m.level ? `${known}, ${level(m.level)}` : known;
  return clamp(`${head}, ${MACHINE_STATES[state]}. ${scene}`.trim());
}

/** A dungeon floor's map in words: each room in turn, as its hex reads. */
export function floorAlt(floor: string, rooms: string[]): string {
  return clamp(`A map of the rooms of ${floor}. ${rooms.filter(Boolean).join(". ")}.`);
}
