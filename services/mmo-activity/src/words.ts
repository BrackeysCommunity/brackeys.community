import { names } from "virtual:pack";

import {
  UnitBeats,
  UnitEncounter,
  type Fact,
  type Goods,
  type HaywireLine,
  type PracticeLine,
  type PuzzleResult,
  type Reason,
  type Refusal,
} from "./api.ts";
import {
  adds,
  amount,
  level,
  plural,
  quantity,
  seconds,
  signed,
  stopwatch,
  uses,
} from "./units.ts";

export { riskLine } from "../../../packages/mmo-words/src/risk.ts";

/** What the pack calls a row; an id it does not name is shown as written. */
export function name(sheet: string, id: string): string {
  return names[`${sheet}:${id}`] ?? sentence(id.replace(/-/g, " "));
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

/** Every good's name in lower case, for the bare-number rule. */
export function goodsNames(): Set<string> {
  const out = new Set<string>();
  for (const [ref, n] of Object.entries(names))
    if (ref.startsWith("items.materials:")) out.add(n.toLowerCase());
  return out;
}

export function goodsLine(goods: Goods[]): string {
  if (goods.length === 0) return "nothing";
  return goods
    .map((g) => amount(g.units, name("items.materials", g.material).toLowerCase()))
    .join(", ");
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
