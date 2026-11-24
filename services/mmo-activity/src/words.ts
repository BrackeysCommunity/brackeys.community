import { names } from "virtual:pack";

import { clampAlt as clamp } from "../../../packages/mmo-words/src/alt.ts";
import { encounterLine, WASTELAND_ENCOUNTERS } from "../../../packages/mmo-words/src/encounters.ts";
import { clueLine as storyClue } from "../../../packages/mmo-words/src/story.ts";
import { countWords } from "../../../packages/mmo-words/src/units.ts";
import {
  UnitBeats,
  UnitEncounter,
  type ActivityState,
  type Fact,
  type Fight,
  type FloorView,
  type Goods,
  type HaywireLine,
  type PracticeLine,
  type PuzzleResult,
  type Reason,
  type Refusal,
  type Tile,
} from "./api.ts";
import {
  adds,
  amount,
  level,
  num,
  outOf,
  plural,
  quantity,
  seconds,
  signed,
  stopwatch,
  uses,
} from "./units.ts";

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
  return found?.[ref] ?? names[ref] ?? sentence(id.replace(/-/g, " "));
}

/** Whether the pack names a row of a sheet. */
export function named(sheet: string, id: string): boolean {
  return `${sheet}:${id}` in names;
}

/** A phrase with its first letter raised. */
export function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  const title = sentence(h.name);
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
  const label = REASONS[r.label] ?? sentence(r.label.replace(/-/g, " "));
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
 * A fact as one line, for the kinds a machine writes. Any other kind is
 * named without its numbers, since their units are not known here.
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
      return `${sentence(f.kind.replace(/[.-]/g, " "))}.`;
  }
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
  return `${sentence(storyClue(f, (i) => `point ${pointName(i)}`))}.`;
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
 * The place a beat's encounter line names, as chat's card names it: a
 * party's beat on a dungeon floor is in the dungeon, any other in the
 * place the character stands.
 */
export function beatPlace(st: Pick<ActivityState, "fight" | "floor" | "place">): string {
  const f = st.fight;
  if (f?.shared && f.floor && st.floor) return dungeonPlace(st.floor);
  return st.place.name ?? "";
}

/** The beat's opening line from the setting's encounter pool: the pick chat's card makes; "" when none fits. */
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
