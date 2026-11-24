import type * as api from "../../src/api.ts";
import samples from "./world.json";

/**
 * Theft and alignment as the world serves them, over the recorded solo
 * replies: what can be stolen at the settlement, a lift, a burgle and a
 * waylay for a side mid-beat with their odds of being seen, a run from the
 * watch, each way a theft ends, the watch at the gate, a fence with hot
 * goods to buy, the invitation and the informer, a syndicate job, a
 * crooked character's card, and the facts all of them write.
 */

export const o = samples.options as api.Options;
export const here = samples.here as api.Here;
export const sheet = samples.sheet as api.Sheet;
const tick = here.place.tick;
const at = here.place.tile.hex;

/** The pack's names for theft and alignment, as the world's lexicon carries them. */
export const names: Record<string, string> = {
  "factions.archetypes:syndicate": "Static",
  "npcs.traits:upright": "Upright",
  "npcs.traits:crooked": "Crooked",
  "fights.beats:slip": "Slip away",
  "fights.options:palm": "Palm it",
  "theft.kinds:lift": "Lift",
  "theft.kinds:burgle": "Burgle",
  "theft.kinds:waylay": "Waylay",
  "theft.kinds:flee": "Run from the watch",
  "alignment.bands:notorious": "Notorious",
  "alignment.bands:crooked": "Crooked",
  "alignment.bands:unremarked": "Unremarked",
  "alignment.bands:decent": "Decent",
  "alignment.bands:upright": "Upright",
};

export const lexicon = (base: api.Lexicon): api.Lexicon => ({
  ...base,
  names: { ...base.names, ...names },
});

const fence: api.Person = {
  id: "r--28,0-den-fence-0",
  name: "Quill Harrow",
  role: "fence",
  kind: "resident",
  traits: ["Crooked", "patient"],
  saved: true,
  visit: false,
  leaning: "crooked",
  fence: true,
};
const keeper = here.people[0]!;
const captain = here.people.find((p) => p.role === "watch captain")!;

/** The settlement with the den's fence standing in it, seen by a crooked character. */
export const atDen: api.Here = { ...here, people: [...here.people, fence] };

const part = (label: string, value: number): api.Part => ({ label, value, unit: "%" });

export const steals: api.StealTarget[] = [
  { kind: "burgle", name: "the Rustwater Compact's store", worth: 30, witness: 31 },
  { kind: "lift", npc: keeper.id, name: keeper.name, worth: 18, witness: 47 },
  {
    kind: "waylay",
    caravan: "cv-3",
    name: "a caravan bound for Greywater",
    worth: 44,
    witness: 100,
    forSide: "q-77",
  },
];

/** Where a theft could begin: the recorded settlement, with targets. */
export const stealable: api.Options = { ...o, steals };

const option = (
  id: string,
  kind: string,
  band: string,
  parts: api.Part[] = [{ label: "practice", value: 4, unit: "pts" }],
): api.Option => ({
  id,
  verb: id,
  kind,
  band,
  risk: id === "back-out" ? "none" : "durability",
  riskSize: id === "back-out" ? 0 : 2,
  why: { parts, bandFrom: band, bandTo: band },
});

const stealFight = (over: Partial<api.Fight>, theft: api.Theft): api.Options => ({
  ...o,
  fight: {
    id: "t-c-1-1",
    beat: 0,
    beats: 1,
    kind: "slip",
    creature: "",
    ambush: false,
    options: [
      option("palm", "win", "likely"),
      option("hold", "cautious", "even"),
      option("back-out", "way-out", "certain"),
    ],
    theft,
    ...over,
  },
});

export const lifting = stealFight(
  {},
  {
    kind: "lift",
    victim: keeper.name,
    witness: 47,
    witnessWhy: {
      parts: [part("base", 40), part("upright", 20), part("sleight", -9), part("cover", -4)],
    },
    worth: 18,
    coin: 18,
  },
);

export const burgling = stealFight(
  { id: "t-c-1-2", beats: 2, kind: "lock", options: [option("pick-lock", "win", "even")] },
  {
    kind: "burgle",
    victim: "the Rustwater Compact",
    witness: 5,
    witnessWhy: {
      parts: [part("base", 30), part("sleight", -18), part("cover", -12), part("quiet", -15)],
    },
    worth: 30,
    haul: [{ material: "scrap-iron", units: 5 }],
  },
);

export const waylaying = stealFight(
  {
    id: "t-c-1-3",
    beat: 1,
    beats: 3,
    kind: "clash",
    options: [option("strike", "win", "long-shot"), option("back-out", "way-out", "certain")],
  },
  {
    kind: "waylay",
    victim: "a caravan bound for Greywater",
    witness: 100,
    witnessWhy: { parts: [] },
    worth: 44,
    haul: [{ material: "scrap-iron", units: 11 }],
    forSide: "q-77",
    caught: true,
  },
);

export const fleeing = stealFight(
  { id: "t-c-1-4", beats: 2, kind: "chase", options: [option("run", "win", "even")] },
  {
    kind: "flee",
    victim: "the watch",
    witness: 0,
    witnessWhy: { parts: [] },
    worth: 18,
    flee: true,
  },
);

const fact = (kind: string, data: api.Datum[], weight = 40): api.Fact => ({
  id: 9100,
  tick,
  kind,
  subjects: [{ kind: "character", id: "c-1" }],
  data,
  weight,
});

const theftFact = (data: api.Datum[]) => fact("theft.made", [{ k: "settlement", n: 0 }, ...data]);

export const wonUnseen = theftFact([
  { k: "kind", s: "lift" },
  { k: "outcome", s: "won" },
  { k: "witnessed", n: 0 },
  { k: "worth", n: 18 },
  { k: "coin", n: 18 },
]);
export const wonSeen = theftFact([
  { k: "kind", s: "burgle" },
  { k: "outcome", s: "won" },
  { k: "witnessed", n: 1 },
  { k: "worth", n: 30 },
  { k: "units", n: 5 },
  { k: "material", s: "scrap-iron" },
  { k: "standing", n: -3 },
]);
export const lost = theftFact([
  { k: "kind", s: "lift" },
  { k: "outcome", s: "lost" },
  { k: "witnessed", n: 1 },
  { k: "worth", n: 18 },
]);
export const empty = theftFact([
  { k: "kind", s: "lift" },
  { k: "outcome", s: "empty" },
  { k: "witnessed", n: 0 },
  { k: "worth", n: 0 },
]);
export const forSide = theftFact([
  { k: "kind", s: "waylay" },
  { k: "outcome", s: "won" },
  { k: "witnessed", n: 1 },
  { k: "worth", n: 44 },
  { k: "units", n: 11 },
  { k: "material", s: "scrap-iron" },
  { k: "side", s: "q-77" },
]);
export const moved = fact("alignment.moved", [
  { k: "act", s: "theft" },
  { k: "asked", n: -3 },
  { k: "delta", n: -3 },
  { k: "value", n: -15 },
  { k: "band", s: "crooked" },
  { k: "public", n: 1 },
]);
export const betrayed = fact(
  "character.betrayed",
  [
    { k: "faction", s: "syndicate" },
    { k: "act", s: "informed" },
    { k: "standing", n: -50 },
  ],
  60,
);
export const fled = fact("watch.fled", [{ k: "settlement", n: 0 }]);
export const caught = fact("watch.caught", [{ k: "settlement", n: 0 }]);

/** Every fact kind theft and alignment write, with the data each carries. */
export const kinds: api.Fact[] = [
  moved,
  wonSeen,
  lost,
  empty,
  fact("watch.stopped", [{ k: "settlement", n: 0 }]),
  fact("watch.paid", [{ k: "fine", n: 30 }]),
  fled,
  caught,
  fact("fence.bought", [
    { k: "pay", n: 18 },
    { k: "units", n: 5 },
  ]),
  fact("fence.came", []),
  fact("craft.laundered", [
    { k: "fee", n: 7 },
    { k: "worth", n: 40 },
    { k: "standing", n: 0 },
  ]),
  fact("syndicate.made", []),
  fact("syndicate.unmade", []),
  fact("syndicate.posted", [{ k: "reward", n: 12 }]),
  betrayed,
  fact("den.moved", [{ k: "cause", s: "informed" }]),
];

const wanted: api.WantedIn[] = [
  { victim: "the Rustwater Compact", places: [here.name, "Greywater"], fine: 30, days: 3 },
];
const hot: api.HotGoods[] = [
  { material: "scrap-iron", units: 5, victim: "the Rustwater Compact", days: 7, reach: 0 },
];

/** The character as a seen burglary left it: crooked, wanted, carrying hot goods. */
export const after: api.Character = {
  ...sheet.character,
  alignment: { value: -15, band: "crooked", goodToday: 0, made: false },
  hot,
  wanted,
};

/** A crooked character's sheet: its band, a grudge, hot goods and a wanted entry. */
export const crooked: api.Sheet = {
  ...sheet,
  character: after,
  grudges: [{ with: "syndicate", name: "Static", ends: 74 }],
};

/** Held at the gate by the watch: a fine it can pay, and one it cannot. */
export const stopped: api.Sheet = {
  ...crooked,
  character: {
    ...after,
    coin: 50,
    stopped: { settlement: 0, name: here.name, fine: 30, canPay: true },
  },
};
export const short: api.Sheet = {
  ...stopped,
  character: {
    ...stopped.character,
    coin: 4,
    stopped: { ...stopped.character.stopped!, canPay: false },
  },
};

/** A made character's sheet, carrying a hot item as well as goods. */
export const made: api.Sheet = {
  ...crooked,
  character: {
    ...after,
    alignment: { value: -32, band: "crooked", goodToday: 2, made: true },
    hot: [
      ...hot,
      { item: sheet.pack[0]?.id ?? "i-1", units: 1, victim: keeper.name, days: 4, reach: 14 },
    ],
  },
};

const choice = (id: string, line: string, effect: string, coin?: number): api.Choice => ({
  id,
  line,
  effect,
  ...(coin ? { coin } : {}),
});

/** The fence finds the character: its topic, and the goods it would buy. */
export const fenceTalk: api.Conversation = {
  npc: { ...fence, mood: "warm" },
  topics: [
    {
      id: "fence-approach",
      line: "Quill Harrow looks at what you carry, then at you. Anything to sell?",
      own: false,
      choices: [
        choice("show-goods", "You show what you have.", "none"),
        choice("walk-on", "You walk on.", "none"),
      ],
    },
    {
      id: "the-invitation",
      line: "Quill Harrow says the Static has work for someone like you.",
      own: true,
      choices: [
        choice("take-the-job", "You take the job.", "none"),
        choice("turn-it-down", "You turn it down.", "none"),
      ],
    },
  ],
  met: 2,
  digest: "fence",
  banner: here.banner,
};

/** The watch captain warns a wanted character, and a robbed keeper knows its goods. */
export const watchTalk: api.Conversation = {
  npc: { ...captain, leaning: "upright", mood: "cold" },
  topics: [
    {
      id: "watch-warning",
      line: "Lux Solder has your description. There is a fine to settle.",
      own: false,
      choices: [
        choice("pay-fine", "You pay the fine.", "fine", 30),
        choice("walk-off", "You walk off.", "none"),
      ],
    },
  ],
  met: 1,
  digest: "watch",
  banner: here.banner,
};
export const robbedTalk: api.Conversation = {
  npc: { ...keeper, leaning: "none", mood: "hostile" },
  topics: [
    {
      id: "knows-these-goods",
      line: "Mags Rask stares at what you carry. Those are mine.",
      own: false,
      choices: [
        choice("give-them-back", "You give them back.", "return"),
        choice("deny-it", "You deny it.", "none"),
      ],
    },
  ],
  met: 3,
  digest: "robbed",
  banner: here.banner,
};

const wordSide = (id: string, title: string, goal: string, mine = false): api.Side => ({
  id,
  title,
  wants: "word",
  goal,
  mark: 1,
  filled: 0,
  backers: mine ? 1 : 0,
  pay: 0,
  at: fence.name,
  sponsor: "Static",
  mine,
});

/** The invitation, cast at the den the fence stands in, and the informer, away at the captain's gate. */
export const invitation: api.Arc = {
  id: "a-91",
  template: "the-invitation",
  title: "The invitation",
  scope: "personal",
  cast: [
    { role: "character", kind: "character", id: "c-1" },
    { role: "npc", kind: "npc", id: fence.id, name: fence.name },
    { role: "notable", kind: "npc", id: "syn-captain-0", name: "Vesper Kade" },
    { role: "seat", kind: "settlement", id: "0", name: here.name },
  ],
  regions: [],
  seat: at,
  stage: 0,
  stages: 1,
  due: tick + 720,
  dueDay: 9,
  sides: [
    wordSide("take-the-job", "Take the job", "q-81"),
    wordSide("turn-it-down", "Turn it down", "q-82"),
  ],
  began: tick,
};
export const informer: api.Arc = {
  ...invitation,
  id: "a-92",
  template: "the-informer",
  title: "The informer",
  cast: [
    { role: "character", kind: "character", id: "c-1" },
    { role: "npc", kind: "npc", id: "r-5,2-settlement-watch-0", name: "Odo Brack" },
    { role: "den", kind: "settlement", id: "0", name: here.name },
    { role: "seat", kind: "settlement", id: "2", name: "Greywater" },
  ],
  seat: { q: at.q + 5, r: at.r + 2 },
  sides: [
    { ...wordSide("name-the-fence", "Name the fence", "q-83"), at: "Odo Brack" },
    { ...wordSide("keep-quiet", "Keep quiet", "q-84"), at: "Odo Brack" },
  ],
};

/** A job the Static posted, as the made see it on the board. */
export const job: Partial<api.Goal> = {
  id: "q-90",
  verb: "steal",
  issuer: "syndicate",
  by: "Static",
  title: "A job for the Static",
  what: "steal goods worth 40 coin from the Rustwater Compact",
  reward: 12,
  mode: "first",
  progress: 18,
  count: 40,
  state: "live",
};

/** A theft in the events channel: a store broken into, the thief unnamed. */
export const theftEvent: api.StoryEvent = {
  fact: { ...wonSeen, subjects: [{ kind: "faction", id: "1" }] },
  place: here.name,
  alarm: false,
};
