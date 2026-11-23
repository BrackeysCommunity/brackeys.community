import type * as api from "../../src/api.ts";
import { here as mm9Here, o, siege, withSides } from "./mm9.ts";
import samples from "./world.json";

/**
 * What play made of the world as it serves it: a promotion of every type
 * on the promotions read, a legend laid, a custom held and what a season
 * added; a road cut, a road tolled and a caravan robbed on the events
 * read; the four templates cast; and the cards that show emergence: a
 * road under foot, a camp and a haunt, a variant met with an adapted
 * option, a goal whose target became a legend and one that is a custom, a
 * found class, and a recap line its first may name.
 */

const tick = mm9Here.place.tick;

/** Names the world adds to the lexicon once play finds them, and the pack's that cards here read. */
export const names: Record<string, string> = {
  "creatures.variants:plated": "Plated",
  "items.materials:found.plated.stalker-hide": "Plated eel-hide",
  "map.site-kinds:scrap-seam": "Scrap seam",
  "map.site-kinds:battlefield-ruin": "Battlefield ruin",
  "classes.classes:router": "Router",
  "puzzles.families:rewire": "Rewire",
};

export const lexicon = (base: api.Lexicon): api.Lexicon => ({
  ...base,
  names: { ...base.names, ...names },
});

const fact = (
  id: number,
  kind: string,
  data: api.Datum[],
  subjects: api.Ref[] = [],
  weight = 70,
): api.Fact => ({ id, tick, kind, region: "r-3", subjects, data, weight });

const promotionFact = (id: number, p: api.Promotion, extra: api.Datum[] = []) =>
  fact(
    id,
    "promotion",
    [
      { k: "type", s: p.type },
      { k: "id", s: p.id },
      { k: "name", s: p.name },
      ...(p.of ? [{ k: "of", s: p.of }] : []),
      ...extra,
    ],
    [{ kind: "promotion", id: p.id }],
  );

const promotion = (
  id: string,
  type: string,
  name: string,
  more: Partial<api.Promotion> = {},
): api.Promotion => ({ id, type, name, region: "r-3", day: 30, ...more });

export const road = promotion("road:1", "road", "the Pylon Camp way", { at: { q: -27, r: 0 } });
export const spiralRoad = promotion("road:9", "road", "the Greywater way", { at: { q: 3, r: 4 } });
export const camp = promotion("camp:2", "camp", "the Seam camp", {
  of: "scrap-seam",
  ofName: "Scrap seam",
  at: { q: -24, r: -2 },
});
export const haunt = promotion("haunt:3", "haunt", "the Ruin's ghosts", {
  of: "battlefield-ruin",
  ofName: "Battlefield ruin",
  at: { q: -26, r: 2 },
});
export const route = promotion("route:4", "route", "Pylon Camp–Greywater", { places: [0, 1] });
export const style = promotion("style:5", "style", "Edge-and-ember", {
  of: "edge-and-ember",
  ofName: "Edge-and-ember",
  resists: "keen",
});
export const variant = promotion("variant:6", "variant", "Plated wire-eel", {
  of: "mire-stalker",
  ofName: "Wire-eel",
  resists: "keen",
  material: "found.plated.stalker-hide",
});
/** A variant in a region whose material nobody has looted yet: the lexicon cannot name it. */
export const unlooted = promotion("variant:11", "variant", "Plated rad-hound", {
  of: "cinder-hound",
  ofName: "Rad-hound",
  resists: "keen",
  material: "found.plated.hide-scraps",
});
export const material = promotion("material:7", "material", "Plated eel-hide", {
  of: "found.plated.stalker-hide",
  ofName: "Treated hide",
  material: "found.plated.stalker-hide",
});
export const bountyLegend = promotion("legend:8", "legend", "Wire-eel the Unbroken", {
  of: "creature:mire-stalker",
  ofName: "Wire-eel",
});
export const itemLegend = promotion("legend:10", "legend", "Hook the Patient", {
  of: "item:i-7",
  ofName: "Hook",
});
export const custom = promotion("custom:12", "custom", "the Pylon Camp hauling", {
  places: [0],
});
export const foundClass = promotion("class:13", "class", "Router", {
  of: "router",
  ofName: "Router",
});
export const masters = promotion("masters:14", "masters", "the masters of the Rewire", {
  of: "rewire",
  ofName: "Rewire",
});

const promoted = (id: number, p: api.Promotion, extra: api.Datum[] = [], place?: string) => ({
  fact: promotionFact(id, p, extra),
  promotion: p,
  ...(place ? { place } : {}),
});

/** One of every promotion event the chronicle channel posts, in the order the world wrote them. */
export const promotions: [string, api.StoryEvent][] = [
  ["a road forms", promoted(1001, road)],
  ["a road a solved pattern laid", promoted(1002, spiralRoad, [{ k: "via", s: "pattern" }])],
  ["a camp", promoted(1003, camp)],
  ["a haunt", promoted(1004, haunt)],
  [
    "a trade route",
    promoted(1005, route, [
      { k: "a", n: 0 },
      { k: "b", n: 1 },
    ]),
  ],
  ["a style", promoted(1006, style, [{ k: "resists", s: "keen" }])],
  [
    "a variant",
    promoted(1007, variant, [
      { k: "resists", s: "keen" },
      { k: "material", s: variant.material! },
    ]),
  ],
  [
    "a variant whose material nobody has looted",
    promoted(1008, unlooted, [{ k: "material", s: unlooted.material! }]),
  ],
  ["a material", promoted(1009, material)],
  ["a bounty becomes a legend", promoted(1010, bountyLegend)],
  ["an item becomes a legend", promoted(1011, itemLegend)],
  ["a custom", promoted(1012, custom, [{ k: "verb", s: "haul" }], mm9Here.name)],
  ["a found class", promoted(1013, foundClass)],
  ["the masters", promoted(1014, masters)],
  [
    "a promotion served without its record",
    {
      fact: promotionFact(1015, style, [{ k: "resists", s: "keen" }]),
    },
  ],
  [
    "a legend laid to rest",
    {
      fact: fact(
        1016,
        "legend.laid",
        [
          { k: "id", s: bountyLegend.id },
          { k: "name", s: bountyLegend.name },
        ],
        [{ kind: "promotion", id: bountyLegend.id }],
      ),
      promotion: bountyLegend,
    },
  ],
  [
    "a custom held",
    {
      fact: fact(
        1017,
        "custom.held",
        [
          { k: "id", s: custom.id },
          { k: "name", s: custom.name },
          { k: "goal", s: "q-60" },
        ],
        [
          { kind: "promotion", id: custom.id },
          { kind: "goal", id: "q-60" },
        ],
        40,
      ),
      promotion: custom,
      place: mm9Here.name,
    },
  ],
  [
    "what a season added",
    {
      fact: fact(1018, "season.added", [
        { k: "season", n: 1 },
        { k: "styles", n: 1 },
        { k: "variants", n: 2 },
        { k: "materials", n: 2 },
        { k: "classes", n: 0 },
        { k: "first", s: "Edge-and-ember" },
      ]),
    },
  ],
];

/** One of every emergence fact the events channel posts. */
export const events: [string, api.StoryEvent][] = [
  [
    "a road cut",
    {
      fact: fact(
        1101,
        "road.cut",
        [
          { k: "id", s: road.id },
          { k: "name", s: road.name },
          { k: "days", n: 3 },
        ],
        [{ kind: "promotion", id: road.id }],
        60,
      ),
      promotion: road,
    },
  ],
  [
    "a road tolled",
    {
      fact: fact(
        1102,
        "road.tolled",
        [
          { k: "id", s: road.id },
          { k: "name", s: road.name },
          { k: "days", n: 14 },
          { k: "coin", n: 2 },
        ],
        [
          { kind: "promotion", id: road.id },
          { kind: "arc", id: "a-21" },
        ],
        60,
      ),
      promotion: road,
    },
  ],
  [
    "a caravan robbed",
    {
      fact: fact(
        1103,
        "caravan.robbed",
        [
          { k: "id", s: `${route.id}@28` },
          { k: "route", s: route.id },
          { k: "name", s: route.name },
          { k: "units", n: 15 },
          { k: "q", n: -25 },
          { k: "r", n: 1 },
        ],
        [{ kind: "promotion", id: route.id }],
        60,
      ),
      promotion: route,
    },
  ],
];

const side = (
  id: string,
  title: string,
  wants: string,
  more: Partial<api.Side> = {},
): api.Side => ({
  id,
  title,
  wants,
  goal: `q-${id}`,
  mark: 25,
  filled: 4,
  backers: 2,
  pay: 150,
  at: mm9Here.name,
  sponsor: "Greywater",
  mine: false,
  ...more,
});

const regionArc = (
  id: string,
  template: string,
  title: string,
  cast: api.Arc["cast"],
  sides: api.Side[],
): api.Arc => ({
  ...siege,
  id,
  template,
  title,
  scope: "region",
  cast,
  stages: 1,
  sides,
});

/** The rival claims: two goals racing for one thing became an arc (GDD 17.6). */
export const rivalClaims = regionArc(
  "a-20",
  "the-rival-claims",
  "The rival claims on Greywater",
  [
    { role: "seat-a", kind: "settlement", id: "0", name: mm9Here.name },
    { role: "seat-b", kind: "settlement", id: "1", name: "Greywater" },
    { role: "front", kind: "region", id: "r-3", name: "Greywater" },
  ],
  [
    side("back-a", `Back ${mm9Here.name}`, "goods", { tag: "timber", opponent: "Greywater" }),
    side("back-b", "Back Greywater", "goods", { tag: "timber", at: "Greywater" }),
  ],
);

export const roadWar = regionArc(
  "a-21",
  "the-road-war",
  "The road war on the Pylon Camp way",
  [
    { role: "road", kind: "tile", id: "-27,0", name: road.name },
    { role: "raider", kind: "faction", id: "f-1", name: "Ash Riders" },
  ],
  [
    side("patrol-it", "Patrol it", "beats", { opponent: "Ash Riders" }),
    side("prey-on-it", "Prey on it", "goods", { sponsor: "Ash Riders" }),
  ],
);

export const lostCaravan = regionArc(
  "a-22",
  "the-lost-caravan",
  "The lost caravan on Pylon Camp–Greywater",
  [
    { role: "caravan", kind: "caravan", id: `${route.id}@28`, name: route.name },
    { role: "front", kind: "region", id: "r-3", name: "Greywater" },
  ],
  [
    side("rescue-it", "Rescue it", "reach", { mark: 1, filled: 0, sponsor: "Greywater" }),
    side("salvage-it", "Salvage it", "beats"),
  ],
);

export const legendWakes = regionArc(
  "a-23",
  "the-legend-wakes",
  "Wire-eel the Unbroken wakes",
  [
    { role: "legend", kind: "legend", id: bountyLegend.id, name: bountyLegend.name },
    { role: "front", kind: "region", id: "r-3", name: "Greywater" },
  ],
  [side("hunt-it", "Hunt it", "beats"), side("ward-it", "Ward it", "goods", { tag: "provisions" })],
);

export const templates: api.Arc[] = [rivalClaims, roadWar, lostCaravan, legendWakes];

const cast = (a: api.Arc, id: number): api.StoryEvent => ({
  fact: fact(id, "arc.cast", [
    { k: "arc", s: a.id },
    { k: "template", s: a.template },
    { k: "scope", s: "region" },
    { k: "stage", n: 0 },
  ]),
  arc: a,
});

/** The four templates cast, as the events channel posts them. */
export const casts: [string, api.StoryEvent][] = templates.map((a, i) => [
  `${a.template} cast`,
  cast(a, 1201 + i),
]);

/** The season's close, which names what it kept, faded and added. */
export const seasonClosed: api.StoryEvent = {
  fact: fact(1301, "season.closed", [
    { k: "season", n: 1 },
    { k: "start", n: 14 },
    { k: "days", n: 42 },
  ]),
};

const tile = mm9Here.place.tile;

/** Standing on the Pylon Camp way, a tile out of the settlement. */
export const onRoad: api.Here = {
  ...mm9Here,
  name: "The Pylon Camp way",
  place: {
    ...mm9Here.place,
    tile: {
      ...tile,
      hex: road.at!,
      site: undefined,
      structures: undefined,
      road: 1,
      roadName: road.name,
    },
    rest: false,
  },
  stations: [],
  orders: [],
  offers: [],
  people: [],
  bench: undefined,
  suggest: undefined,
};

export const onTolled: api.Here = {
  ...onRoad,
  place: { ...onRoad.place, tile: { ...onRoad.place.tile, toll: 2 } },
};

export const onCut: api.Here = {
  ...onRoad,
  place: { ...onRoad.place, tile: { ...onRoad.place.tile, cut: true } },
};

/** A camp on a scrap seam: its tier-1 station, where no settlement stands. */
export const atCamp: api.Here = {
  ...onRoad,
  name: "The Scrap seam",
  place: {
    ...onRoad.place,
    tile: {
      ...tile,
      hex: camp.at!,
      site: "site",
      siteKind: "scrap-seam",
      structures: undefined,
      camp: camp.name,
    },
    explore: true,
  },
  stations: [{ kind: "forge", tier: 1, fee: 4 }],
};

/** A haunted battlefield ruin. */
export const atHaunt: api.Here = {
  ...onRoad,
  name: "The Battlefield ruin",
  place: {
    ...onRoad.place,
    tile: {
      ...tile,
      hex: haunt.at!,
      site: "site",
      siteKind: "battlefield-ruin",
      structures: undefined,
      haunted: true,
    },
    explore: true,
  },
};

const map = samples.map as api.MapView;

/** The map with the road running east of the settlement, one tile of it tolled and one cut. */
export const roadMap: api.MapView = {
  ...map,
  tiles: [
    ...map.tiles,
    { ...onRoad.place.tile, hex: { q: -27, r: 0 }, toll: 2 },
    { ...onRoad.place.tile, hex: { q: -27, r: -1 }, cut: true },
    { ...atCamp.place.tile },
  ],
};

/** The moves off the settlement: east onto the tolled road, north-east onto the cut one. */
export const roadMoves: api.Options = {
  ...withSides,
  moves: (o.moves.length ? o.moves : (samples.options as api.Options).moves).map((m) =>
    m.dir === 0
      ? { ...m, ticks: 1, why: { parts: [{ label: "road", value: 1, unit: "ticks" }] } }
      : m,
  ),
};

const fighting = (samples as Record<string, unknown>)["options:fight"] as api.Options;
const f = fighting.fight!;

/** Against the region's variant: the keen strike lost a band to the adaptation. */
export const onVariant: api.Options = {
  ...fighting,
  fight: {
    ...f,
    creature: "mire-stalker",
    creatureName: variant.name,
    variant: "plated",
    options: f.options.map((x) =>
      x.id === "strike"
        ? {
            ...x,
            why: {
              ...x.why,
              parts: [...x.why.parts, { label: "adapted", value: -2, unit: "pts" }],
            },
          }
        : x,
    ),
  },
};

/** Since you left: the style you were first of, still yours to name, and a road that formed. */
export const recap: api.Recap = {
  since: 0,
  tick,
  lines: [
    { rule: 4, fact: promotionFact(1006, style), promotion: style.id },
    { rule: 9, fact: promotionFact(1001, road) },
  ],
  more: 0,
  day: 0,
  awayHours: 0,
};

/** A found class beside the recorded ones, earned by nobody here yet. */
export function withFound(c: api.Classes): api.Classes {
  const base = c.classes[0]!;
  return {
    ...c,
    classes: [
      ...c.classes,
      {
        ...base,
        id: "router",
        name: "Router",
        leans: "Rewiring and circuits together",
        earned: false,
        active: false,
        first: false,
        level: 0,
        found: true,
        needs: [
          { what: "practice rewire", have: 4, at: 12 },
          { what: "practice circuit", have: 2, at: 12 },
        ],
      },
    ],
  };
}

/** A bounty on a creature that became a legend, and a goal its settlement posts as a custom. */
export const legendGoal: Partial<api.Goal> = {
  id: "q-61",
  verb: "defeat",
  title: "The eel bounty",
  what: "defeat 1 creature, a wire-eel",
  count: 1,
  legend: bountyLegend.name,
};
export const customGoal: Partial<api.Goal> = {
  id: "q-60",
  verb: "haul",
  title: "The season's hauling",
  what: "deliver 40 goods of cable fibre",
  count: 40,
  custom: custom.name,
};

/** Refusals a rename meets, as the world words them. */
export const renameRefusals: [string, api.Refusal][] = [
  ["no-such-row", { code: "no-such-row", message: 'no promotion "road:1" to rename' }],
  ["not-first", { code: "not-first", message: "only Edge-and-ember's first renames it" }],
  ["named", { code: "named", message: "it is named Ember-edge" }],
  ["name-closed", { code: "name-closed", message: "Edge-and-ember could be renamed for 7 days" }],
  ["bad-name", { code: "bad-name", message: "a name is 1 to 60 characters the board takes" }],
];
