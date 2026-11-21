import type * as api from "../../src/api.ts";
import type { HuntPost, PartyRead } from "../../src/world.ts";
import samples from "./world.json";

/**
 * Parties, dungeons and hunts as the world serves them, built over the
 * recorded solo replies: a party of three on a shared beat at a bunker,
 * its fork two floors down, and a live hunt beside it.
 */

export const o = samples.options as api.Options;
export const here = samples.here as api.Here;
const fought = samples["options:fight"] as api.Options;

export const members: api.PartyMember[] = [
  { name: "Ossa", you: true, here: true, picked: true, floor: 2, seat: 0 },
  { name: "Brakk", here: true, picked: true, floor: 2, seat: 1, follows: true },
  { name: "Wen", here: true, floor: 2, seat: 2 },
];

export const beat: api.PartyBeat = {
  beat: 3,
  beats: 5,
  kind: "clash",
  picked: 2,
  present: 3,
  opened: 1_800_000_000_000,
  due: 1_800_000_120_000,
  cautious: "hold",
};

/** The viewer's own options on the shared beat. */
export const shared: api.Options = {
  ...fought,
  fight: { ...fought.fight!, shared: true, floor: 2, party: members },
};

export const floor: api.FloorView = {
  dungeon: "-28,0",
  kind: "bunker",
  floor: 2,
  deepest: 2,
  downed: ["Wen"],
};

export const ways: api.WayView[] = [
  { id: "way-0", name: "Flooded stair", tags: ["wet", "dark"], open: true, votes: 1 },
  {
    id: "way-1",
    name: "Collapsed gallery",
    tags: ["unstable"],
    open: false,
    machine: "rewire",
    votes: 0,
  },
];

/** At the fork two floors down: the ways, one vote cast and the window running. */
export const atFork: api.Here = {
  ...here,
  dungeon: "cleared",
  floor: {
    ...floor,
    downed: undefined,
    ways,
    choices: [{ name: "Brakk", push: true, way: "way-0" }],
    opened: 1_800_000_000_000,
    due: 1_800_000_120_000,
  },
};

/** The same fork read by a Mapper, who sees past each way. */
export const mapped: api.Here = {
  ...atFork,
  floor: {
    ...atFork.floor!,
    ways: ways.map((w) => ({ ...w, next: ["dark", "cramped", "flat-runner"] })),
  },
};

export const atEntrance: api.Here = {
  ...here,
  dungeon: "open",
  floor: { dungeon: "-28,0", kind: "bunker", floor: 0, deepest: 2, haunted: true, downed: ["Wen"] },
};

export const inDungeon: api.Here = { ...here, dungeon: "open", floor };

export const party: PartyRead = {
  tick: 13,
  characterId: "c-1",
  version: o.version,
  party: { id: "pt-1", leader: true, members, beat: { ...beat, mine: "strike" } },
  reach: [
    { characterId: "c-4", name: "Kestrel" },
    { characterId: "c-5", name: "Mara", inParty: true },
  ],
  invites: [],
  floor,
  fight: shared.fight,
  thread: { party: "pt-1", members: ["d-1", "d-2", "d-3"] },
};

/** The same party before the viewer has picked. */
export const choosing: PartyRead = {
  ...party,
  party: { ...party.party!, beat: { ...beat, picked: 1, mine: undefined } },
};

/** A character in no party, holding an invitation, with others in reach. */
export const alone: PartyRead = {
  tick: 13,
  characterId: "c-1",
  version: o.version,
  reach: [{ characterId: "c-2", name: "Brakk" }],
  invites: [{ party: "", characterId: "c-2", name: "Brakk", until: 19 }],
};

export const board: api.PartyBoard = {
  id: "pt-1",
  members: [
    { characterId: "c-1", discordId: "d-1", name: "Ossa", picked: true },
    { characterId: "c-2", discordId: "d-2", name: "Brakk", picked: true },
    { characterId: "c-3", discordId: "d-3", name: "Wen" },
  ],
  beat,
  opened: beat.opened,
  due: beat.due,
};

export const forkBoard: api.PartyBoard = {
  id: "pt-1",
  members: board.members.map((m, i) => ({ ...m, picked: false, chose: i === 1 })),
  fork: { dungeon: "-28,0", kind: "bunker", floor: 2, ways },
  opened: beat.opened,
  due: beat.due,
};

export const idleBoard: api.PartyBoard = {
  id: "pt-1",
  members: board.members.map((m) => ({ ...m, picked: false })),
};

const fact = (kind: string, who: string, data: api.Datum[]): api.Fact => ({
  id: 1,
  tick: 13,
  kind,
  subjects: [
    { kind: "character", id: who },
    { kind: "party", id: "pt-1" },
  ],
  data,
  weight: 15,
});

/** A party beat resolved: two members won it, one lost. */
export const resolved: api.Fact[] = [
  fact("beat.won", "c-1", [
    { k: "option", s: "strike" },
    { k: "score", n: 4 },
    { k: "beat", n: 3 },
  ]),
  fact("beat.won", "c-2", [
    { k: "option", s: "smash" },
    { k: "score", n: 2 },
    { k: "beat", n: 3 },
  ]),
  fact("beat.lost", "c-3", [
    { k: "option", s: "hold" },
    { k: "score", n: 1 },
    { k: "beat", n: 3 },
  ]),
  fact("party.beat", "c-1", [
    { k: "beat", n: 3 },
    { k: "pressed", n: 3 },
    { k: "won", n: 2 },
  ]),
];

/** The last beat resolved, and the encounter won with it. */
export const ended: api.Fact[] = [
  ...resolved,
  fact("encounter.won", "c-1", [
    { k: "beats", n: 5 },
    { k: "haul", n: 12 },
  ]),
];

/** The bottom floor's guardian slain, by a party whose members are the first. */
export const slain: api.Fact[] = [
  ...ended,
  fact("guardian.slain", "c-1", [
    { k: "q", n: -28 },
    { k: "r", n: 0 },
    { k: "rolled:cinder-ore", n: 9 },
  ]),
  fact("dungeon.slain-first", "c-1", [
    { k: "q", n: -28 },
    { k: "r", n: 0 },
  ]),
];

/** Standing at the bottom's entrance once climbed out, first to slay its guardian. */
export const named: api.Here = { ...atEntrance, recent: [slain.at(-1)!] };

export const names = new Map([
  ["c-1", "Ossa"],
  ["c-2", "Brakk"],
  ["c-3", "Wen"],
]);

export const hunt: HuntPost = {
  id: "hn-1",
  row: "dust-runner-migration",
  name: "The dust-runner migration",
  creature: "flat-runner",
  at: { q: -27, r: 0 },
  region: "r-3",
  health: 690,
  max: 1000,
  ends: 157,
  pressers: [
    { name: "Ossa", removed: 180 },
    { name: "Brakk", removed: 130 },
  ],
  spoils: [{ material: "cinder-ore", units: 20 }],
  banner: here.banner,
};

export const huntView: api.HuntView = {
  id: "hn-1",
  name: hunt.name,
  creature: hunt.creature,
  health: 690,
  max: 1000,
  ends: 157,
  endsIn: 144,
  pressers: [
    { name: "Ossa", removed: 180, you: true },
    { name: "Brakk", removed: 130 },
  ],
  mine: 180,
  share: 58,
  spoils: hunt.spoils,
  canPress: true,
  options: fought.fight!.options,
};

export const huntSlain: HuntPost = {
  ...hunt,
  health: 0,
  closed: true,
  slain: true,
  rolled: [{ material: "cinder-ore", units: 14 }],
  shares: [
    { name: "Ossa", removed: 560, goods: [{ material: "cinder-ore", units: 8 }] },
    { name: "Brakk", removed: 440, goods: [{ material: "cinder-ore", units: 6 }] },
  ],
};

export const huntLeft: HuntPost = { ...hunt, closed: true };

export const huntBoard: api.HuntBoard = { tick: 13, every: 1, hunts: [hunt] };
