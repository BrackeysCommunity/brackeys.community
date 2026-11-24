import type * as api from "../../src/api.ts";
import samples from "./world.json";

/**
 * A saved NPC as the world serves it with its dossier: the recorded
 * tinker, met before, with a topic that states a number, a line it said
 * last time, and a memory past its cap with entries folded away.
 */

const recorded = samples.npc as api.Conversation;
const TICKS_PER_DAY = 144;

export const npc = recorded.npc;

/** What the tinker said to this player last time: the first meeting's line. */
export const lastLine = recorded.topics[0]!.line;

export const longerRoad: api.Topic = {
  id: "a-longer-road",
  line: `${npc.name}'s road takes 12 tiles longer than when they first walked it.`,
  own: true,
  choices: [
    { id: "clear-path", line: "You say you will clear it.", effect: "goal" },
    { id: "shrug", line: "You shrug.", effect: "none" },
  ],
};

export const dossier: api.Dossier = {
  day: 9,
  role: "tinker",
  traits: ["Secretive", "Humble"],
  faction: "The Salt Eaters",
  place: "Pylon Camp",
  about: [{ kind: "greeted", tick: 8 * TICKS_PER_DAY, who: "you" }],
  world: [{ kind: "fortune", tick: 7 * TICKS_PER_DAY, fact: 41 }],
  oldest: [
    { kind: "greeted", tick: 2 * TICKS_PER_DAY, who: "you" },
    { kind: "traded", tick: 3 * TICKS_PER_DAY, who: "c-77", thing: "Copper wire" },
    {
      kind: "resold",
      tick: 4 * TICKS_PER_DAY,
      who: "a traveller from Iron Kin",
      thing: "Glass fibre",
      n: 12,
      unit: "coin",
    },
  ],
  folded: [
    { type: "greeted", count: 31 },
    { type: "traded", count: 6 },
  ],
  foldedTotal: 37,
  names: {
    [`npc:${npc.id}`]: npc.name,
    "settlement:s-2": "Pylon Camp",
    "faction:f-1": "The Salt Eaters",
    "guild:g-1": "Iron Kin",
  },
};

/** The tinker's conversation on a world day, with its dossier. */
export function conversation(
  o: { day?: number; last?: string; folded?: boolean; digest?: string } = {},
): api.Conversation {
  const day = o.day ?? dossier.day;
  const d: api.Dossier = { ...dossier, day };
  if (o.folded === false) {
    delete d.folded;
    d.foldedTotal = 0;
  }
  return {
    ...recorded,
    topics: [recorded.topics[1]!, longerRoad, recorded.topics[2]!],
    last: o.last ?? lastLine,
    met: 3,
    digest: o.digest ?? `voice-day-${day}`,
    dossier: d,
  };
}

/** The same conversation as a world without the dossier serves it. */
export function plain(c: api.Conversation): api.Conversation {
  const { dossier: _, ...rest } = c;
  return rest;
}
