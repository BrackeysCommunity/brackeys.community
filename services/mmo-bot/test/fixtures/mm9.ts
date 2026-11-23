import type * as api from "../../src/api.ts";
import samples from "./world.json";

/**
 * The story as the world serves it, built over the recorded solo replies:
 * season zero on its fourth day, a siege of the recorded settlement with a
 * goods side served there and a beats side, a raid at the settlement with
 * its hunt, the chronicle of a closed day and a fact's causes, the events
 * channel's facts, a city's needs, and a pattern's point out on a site.
 */

export const o = samples.options as api.Options;
export const here = samples.here as api.Here;
const recordedGuild = samples.guild as unknown as api.Guild;

const at = here.place.tile.hex;
const tick = here.place.tick;

export const season: api.Season = { n: 0, day: 4, days: 14, band: "rising", ends: 2016 };

const fact = (
  id: number,
  kind: string,
  data: api.Datum[],
  subjects: api.Ref[] = [],
  weight = 80,
): api.Fact => ({ id, tick, kind, subjects, data, weight });

export const garrison: api.Side = {
  id: "garrison",
  title: "Hold the garrison",
  wants: "goods",
  tag: "provisions",
  goal: "q-41",
  mark: 50,
  filled: 12,
  backers: 2,
  pay: 300,
  at: here.name,
  atHex: at,
  sponsor: "Rustwater Compact",
  opponent: "Ash Riders",
  mine: false,
};

export const besiegers: api.Side = {
  id: "besiegers",
  title: "Break the siege lines",
  wants: "beats",
  goal: "q-42",
  mark: 50,
  filled: 30,
  backers: 3,
  pay: 280,
  at: "Greywater",
  sponsor: "Ash Riders",
  opponent: "Rustwater Compact",
  mine: false,
};

export const siege: api.Arc = {
  id: "a-7",
  template: "the-siege",
  title: "The siege of Pylon Camp",
  scope: "world",
  cast: [
    { role: "seat", kind: "faction", id: "f-0", name: "Rustwater Compact" },
    { role: "besieger", kind: "faction", id: "f-1", name: "Ash Riders" },
    { role: "region", kind: "region", id: "r-3", name: "Greywater" },
    { role: "witness", kind: "character", id: "c-2" },
  ],
  regions: ["Greywater"],
  seat: at,
  stage: 0,
  stages: 3,
  due: 864,
  dueDay: 6,
  sides: [garrison, besiegers],
  began: 432,
};

/** The same siege with the viewer backing its garrison. */
export const backing: api.Arc = {
  ...siege,
  sides: [{ ...garrison, mine: true, backers: 3 }, besiegers],
};

/** The siege where the garrison is served elsewhere: the card offers the road there. */
export const elsewhere: api.Arc = {
  ...siege,
  sides: [{ ...garrison, at: "Rustwater Hold", atHex: { q: -20, r: 3 } }, besiegers],
};

export const ended: api.Arc = { ...siege, stage: 2, outcome: "garrison", lapsed: false };
export const lapsed: api.Arc = { ...siege, stage: 1, outcome: "lapsed", lapsed: true };

export const raidCast = fact(
  901,
  "region.raids",
  [{ k: "threat", n: 620 }],
  [{ kind: "region", id: "r-3" }],
  70,
);

export const trouble: api.Trouble = {
  arc: "a-8",
  kind: "raid",
  title: "Raid",
  banner: "Raiders on the road",
  why: raidCast,
  mark: 14,
  defence: 5,
  ends: tick + 120,
  hunt: "h-2",
};

export const raidArc: api.Arc = {
  id: "a-8",
  template: "raid",
  title: "Raid",
  scope: "settlement",
  cast: [],
  regions: ["Greywater"],
  seat: at,
  stage: 0,
  stages: 1,
  due: tick + 120,
  dueDay: 5,
  trouble,
  sides: [
    {
      id: "hold-it-off",
      title: "Hold it off",
      wants: "defence",
      goal: "q-43",
      mark: 14,
      filled: 5,
      backers: 1,
      pay: 90,
      at: here.name,
      atHex: at,
      sponsor: "Rustwater Compact",
      mine: false,
    },
  ],
  began: tick,
};

export const arcs: api.Arcs = { season, open: [siege, raidArc], ended: [ended], backing: [] };

/** The settlement with a raid on it. */
export const raided: api.Here = { ...here, place: { ...here.place, trouble } };

/** The settlement with a caravan in, and someone come along the road to meet the viewer. */
export const visited: api.Here = {
  ...here,
  place: {
    ...here.place,
    occasion: { kind: "caravan", banner: "A caravan comes in", ends: tick + 60 },
    city: { city: true, raised: 200 },
  },
  people: [...here.people.slice(0, 2), { ...here.people[2]!, called: true }],
};

export const clue = fact(
  902,
  "pattern.clue",
  [
    { k: "board", s: "triangle@3,4" },
    { k: "rule", s: "triangle" },
    { k: "says", s: "offset" },
    { k: "point", n: 0 },
    { k: "other", n: 1 },
    { k: "n", n: 2 },
  ],
  [],
  60,
);

export const point: api.PatternPoint = {
  board: "triangle@3,4",
  kind: "state",
  place: "pylon",
  family: "circuit",
  point: 1,
  points: 3,
  values: 4,
  held: 2,
  solved: false,
  clues: [clue],
  lapseDays: 3,
};

/** Out on a pylon of the triangle, away from any settlement. */
export const onPoint: api.Here = {
  ...here,
  name: "The Pylon Field",
  place: {
    ...here.place,
    tile: { ...here.place.tile, hex: { q: 3, r: 4 }, structures: undefined, found: 9 },
    pattern: point,
    explore: false,
    rest: false,
  },
  stations: [],
  orders: [],
  offers: [],
  people: [],
  bench: undefined,
  suggest: undefined,
};

/** A beacon of a pattern, lit by a delivery, already solved. */
export const onSolved: api.Here = {
  ...onPoint,
  place: {
    ...onPoint.place,
    pattern: { ...point, place: "beacon", family: undefined, held: undefined, solved: true },
    open: true,
  },
};

export const stageBegan = fact(
  903,
  "arc.cast",
  [
    { k: "arc", s: siege.id },
    { k: "template", s: siege.template },
    { k: "scope", s: "world" },
    { k: "stage", n: 0 },
    { k: "due", n: siege.due },
    { k: "mark:garrison", n: 50 },
    { k: "mark:besiegers", n: 50 },
  ],
  [
    { kind: "arc", id: siege.id },
    { kind: "faction", id: "f-0" },
    { kind: "faction", id: "f-1" },
  ],
);

const stageEnd = (side: string, backers: number, units: number) =>
  fact(904, "arc.stage-ended", [
    { k: "arc", s: siege.id },
    { k: "template", s: siege.template },
    { k: "scope", s: "world" },
    { k: "stage", n: 0 },
    { k: "side", s: side },
    { k: "backers", n: backers },
    { k: "units", n: units },
    { k: "lapsed", n: side === "lapsed" ? 1 : 0 },
  ]);

const troubleFact = (kind: string) =>
  fact(905, kind, [
    { k: "arc", s: raidArc.id },
    { k: "template", s: "raid" },
    { k: "scope", s: "settlement" },
    { k: "stage", n: 0 },
    { k: "settlement", n: 0 },
    { k: "mark:hold-it-off", n: 14 },
    { k: "backers", n: 2 },
    { k: "units", n: 9 },
  ]);

const seasonFact = (kind: string) =>
  fact(906, kind, [
    { k: "season", n: 0 },
    { k: "start", n: 0 },
    { k: "days", n: 14 },
  ]);

const placeFact = (kind: string, data: api.Datum[] = []) =>
  fact(907, kind, [{ k: "settlement", n: 0 }, ...data], [{ kind: "settlement", id: "0" }]);

/** One of every fact the events channel posts, as the world serves it. */
export const events: [string, api.StoryEvent][] = [
  [
    "a raid's alarm",
    { fact: troubleFact("trouble.started"), trouble, place: here.name, alarm: true },
  ],
  [
    "a fire at a settlement",
    {
      fact: { ...troubleFact("trouble.started"), data: [{ k: "template", s: "fire" }] },
      trouble: { ...trouble, kind: "fire", title: "Fire", hunt: undefined, why: undefined },
      place: here.name,
    },
  ],
  ["a raid held off", { fact: troubleFact("trouble.held"), trouble, place: here.name }],
  ["a raid got in", { fact: troubleFact("trouble.lost"), place: here.name }],
  ["an arc cast", { fact: stageBegan, arc: siege }],
  [
    "an arc's next stage",
    { fact: { ...stageBegan, kind: "arc.stage-began" }, arc: { ...siege, stage: 1 } },
  ],
  ["a stage won", { fact: stageEnd("garrison", 3, 50), arc: { ...siege, stage: 1 } }],
  ["a stage lapsed", { fact: stageEnd("lapsed", 1, 6), arc: lapsed }],
  [
    "an arc ended",
    {
      fact: fact(908, "arc.ended", [
        { k: "arc", s: siege.id },
        { k: "template", s: siege.template },
        { k: "outcome", s: "garrison" },
        { k: "lapsed", n: 0 },
        { k: "stages", n: 3 },
      ]),
      arc: ended,
    },
  ],
  ["a season began", { fact: seasonFact("season.began") }],
  ["a season's finale", { fact: seasonFact("season.finale") }],
  ["a season's close", { fact: seasonFact("season.closed") }],
  [
    "a city raised",
    { fact: placeFact("city.raised", [{ k: "coin", n: 10_000 }]), place: here.name },
  ],
  ["a city fallen back", { fact: placeFact("city.fell-back"), place: here.name }],
  ["a settlement ruined", { fact: placeFact("settlement.ruined"), place: "Cinder Gate" }],
  ["a faction's city", { fact: placeFact("faction.city"), place: "The Exchange" }],
  [
    "the core opened",
    {
      fact: fact(909, "core.opened", [
        { k: "season", n: 0 },
        { k: "towers", n: 8 },
      ]),
    },
  ],
  [
    "a pattern solved",
    {
      fact: fact(910, "pattern.solved", [
        { k: "board", s: "triangle@3,4" },
        { k: "rule", s: "triangle" },
        { k: "kind", s: "state" },
      ]),
    },
  ],
];

export const chronicle: api.Chronicle = {
  season,
  day: 3,
  lines: [
    { fact: stageBegan, here: true, causes: 1 },
    { fact: troubleFact("trouble.lost"), here: true, causes: 1 },
    { fact: raidCast, causes: 0 },
  ],
  more: 4,
  earlier: [2, 1, 0],
};

/** Before any world day has closed. */
export const unwritten: api.Chronicle = { season, day: -1, lines: [], more: 0, earlier: [] };

export const causes: api.FactCauses = { fact: stageBegan, causes: [raidCast, clue] };
export const uncaused: api.FactCauses = { fact: raidCast, causes: [] };

/** What a city still needs, as an officer standing in the guild's first settlement reads it. */
export const needs: api.CityNeed[] = [
  { id: "size", have: 12, need: 50, unit: "characters", met: false },
  { id: "standing", have: 7, need: 7, unit: "days", met: true },
  { id: "works", have: 4, need: 4, unit: "works", met: true },
  { id: "resources", have: 0, need: 3, unit: "goods", met: false },
  { id: "coin", have: 4_000, need: 10_000, unit: "coin", met: false },
  { id: "tiles", have: 6, need: 6, unit: "tiles", met: true },
];

export function cityGuild(guild: api.Guild, city: api.CityState): api.Guild {
  return {
    ...guild,
    officer: true,
    settlements: (guild.settlements.length ? guild.settlements : recordedGuild.settlements).map(
      (s, i) => ({ ...s, here: i === 0, city: i === 0 ? city : { city: false } }),
    ),
  };
}

/** The options of a character who could back the siege's sides. */
export const withSides: api.Options = {
  ...o,
  purse: { ...o.purse, provisions: 18 },
  sides: [
    {
      goal: garrison.goal,
      arc: siege.id,
      side: garrison.id,
      wants: "goods",
      tag: "provisions",
      left: 38,
      at,
      region: "Greywater",
      backed: false,
    },
    {
      goal: besiegers.goal,
      arc: siege.id,
      side: besiegers.id,
      wants: "beats",
      left: 20,
      at: { q: -24, r: 2 },
      region: "Greywater",
      backed: false,
    },
  ],
};

/** Since you left, with an arc that ended and a trouble at the character's place. */
export const recap: api.Recap = {
  since: 0,
  tick,
  lines: [
    { rule: 9, kind: "arc", fact: events[8]![1].fact },
    { rule: 9, kind: "trouble", fact: troubleFact("trouble.lost") },
  ],
  more: 0,
  day: 0,
  awayHours: 0,
};
