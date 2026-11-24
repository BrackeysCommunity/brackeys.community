import type * as api from "../../src/api.ts";
import * as mm9 from "./mm9.ts";
import * as mm10 from "./mm10.ts";

/**
 * The story as the world serves it with names: the chronicle of a closed
 * day, every event the events channel tells with its causes, those it
 * shows only as templates, and since-you-left returns either side of the
 * hours that narrate it.
 */

/** What the fixture's refs are called, keyed as the world keys them. */
export const names: Record<string, string> = {
  "settlement:0": mm9.here.name,
  "region:r-3": "Greywater",
  "faction:f-0": "Order of the Dust",
  "faction:f-1": "the Salt Eaters",
};

const tick = mm9.here.place.tick;
const fact = (
  id: number,
  kind: string,
  data: api.Datum[],
  subjects: api.Ref[] = [],
  weight = 80,
): api.Fact => ({ id, tick, kind, subjects, data, weight });

/** A day with more lines than the chronicle's prose has sentences. */
export const chronicle: api.Chronicle = {
  ...mm9.chronicle,
  lines: [
    ...mm9.chronicle.lines,
    {
      fact: fact(
        911,
        "settlement.ruined",
        [{ k: "settlement", n: 0 }],
        [{ kind: "settlement", id: "0" }],
      ),
      here: true,
    },
    { fact: fact(912, "region.overrun", [], [{ kind: "region", id: "r-3" }]) },
  ],
  names,
};

/** The same day as another server reads it: none of its places are that server's. */
export const elsewhere: api.Chronicle = {
  ...chronicle,
  lines: chronicle.lines.map((l) => ({ ...l, here: false })),
};

const event = (label: string) => mm9.events.find(([n]) => n === label)![1];

/** What led to a fact, as the world serves it with its names. */
function caused(f: api.Fact, ...causes: api.Fact[]): api.FactCauses {
  return { fact: f, causes, names };
}

/** Each event the channel tells with its causes, and the causes the poster reads for it. */
export const told: [string, api.StoryEvent, api.FactCauses][] = [
  "a stage won",
  "a stage lapsed",
  "a raid held off",
  "a raid got in",
  "an arc ended",
  "a season's finale",
  "a season's close",
].map((label) => {
  const ev = { ...event(label), names };
  return [label, ev, caused(ev.fact, mm9.clue, mm9.raidCast)];
});

/** Events the channel shows as their templates whatever the switch says. */
export const untold: [string, api.StoryEvent][] = [
  ["a raid's alarm", { ...event("a raid's alarm"), names }],
  ["an arc cast", { ...event("an arc cast"), names }],
  ["a city raised", { ...event("a city raised"), names }],
  ...mm10.events.filter(([, ev]) =>
    ["road.cut", "road.tolled", "caravan.robbed"].includes(ev.fact.kind),
  ),
];

/** Every fact the events channel reads, causes by fact id. */
export const causes = new Map(told.map(([, ev, c]) => [ev.fact.id, c]));

/** Since you left, after an absence of the hours given. */
export function recap(awayHours: number, lines = mm9.recap.lines): api.Recap {
  return {
    ...mm9.recap,
    lines: [...lines, { rule: 4, npc: mm9.here.people[0]!.id }],
    day: 6,
    awayHours,
    names,
  };
}

/** A later return the same day, with something new to tell. */
export const later: api.RecapLine[] = [
  { rule: 9, kind: "trouble", fact: fact(913, "trouble.held", mm9.recap.lines[1]!.fact!.data) },
];
