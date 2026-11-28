import type * as api from "../../src/api.ts";
import type { Card } from "../../src/card.ts";
import type { Lexicon } from "../../src/lexicon.ts";
import { promotionCard } from "../../src/screens/emergence.ts";
import { forgetAskCard, forgetDoneCard } from "../../src/screens/forget.ts";

/**
 * A season's rules epoch as the promotions route serves it, with the notes
 * a cell diff of two books gives, and the /forget-me cards.
 */

export const FROM = "1767b7ef4195f4ed9111080584e96faace0a56b0e16680517e9cb4bc46387334";
export const TO = "e8c6596bf0331a3d55c0e1f1b9d27a8f6c1e44d8a0b7f3c2d1e0f9a8b7c6d5e4";

/** The season-close art the world attaches to an epoch. */
export const ART: api.Art = { key: "art-season-close-0a1b2c", slot: "season-close" };

/** Every kind of note the diff writes, one sheet unit after another. */
export const NOTES: api.EpochNote[] = [
  {
    sheet: "items.materials",
    row: "cinder-ore",
    name: "Cinder ore",
    column: "tier",
    change: "changed",
    before: "1",
    after: "2",
    unit: "tier",
  },
  {
    sheet: "economy.params",
    row: "market-fee",
    column: "value",
    change: "changed",
    before: "5",
    after: "6",
    unit: "percent",
  },
  {
    sheet: "fights.odds-bands",
    row: "long-shot",
    column: "chance",
    change: "changed",
    before: "0.25",
    after: "0.3",
    unit: "chance",
  },
  {
    sheet: "items.slots",
    row: "blade",
    column: "edge",
    change: "changed",
    before: "1.2",
    after: "1.25",
    unit: "ratio",
  },
  {
    sheet: "mounts.kinds",
    row: "stilt-rig",
    name: "Stilt rig",
    column: "load",
    change: "changed",
    before: "40",
    after: "45",
    unit: "load",
  },
  {
    sheet: "puzzles.families",
    row: "boiler-room",
    column: "countdown",
    change: "changed",
    before: "90",
    after: "80",
    unit: "seconds",
  },
  {
    sheet: "liveops.templates",
    row: "drop-1",
    column: "crates",
    change: "changed",
    before: "3",
    after: "4",
    unit: "count",
  },
  {
    sheet: "alignment.acts",
    row: "steal",
    column: "move",
    change: "changed",
    before: "-5",
    after: "-16",
    unit: "count",
  },
  {
    sheet: "economy.route-risk",
    row: "long-shot",
    name: "a long shot",
    column: "threat",
    change: "changed",
    before: "600",
    after: "1250",
    unit: "gauge",
  },
  {
    sheet: "mounts.kinds",
    row: "stilt-rig",
    name: "Stilt rig",
    column: "roadOnly",
    change: "changed",
    before: "no",
    after: "yes",
    unit: "flag",
  },
  {
    sheet: "items.traits",
    row: "keen",
    column: "favours",
    change: "changed",
    before: "fights won in 2 beats",
    after: "fights won in 3 beats",
    unit: "text",
  },
  {
    sheet: "items.materials",
    row: "glass-shard",
    name: "Glass shard",
    change: "added",
    after: '{"id":"glass-shard","tier":2,"vector":{"edge":3}}',
  },
  {
    sheet: "settlements.structures",
    row: "watchtower",
    name: "Watchtower",
    change: "removed",
    before: '{"id":"watchtower","maxTier":3}',
  },
  {
    sheet: "fights.hunts",
    row: "cinder-hound",
    name: "Cinder hound",
    column: "spoils",
    change: "changed",
    before: "1200",
    after: "1500",
    unit: "goods",
  },
];

/** More notes than the card lists, each another unit: tags, xp, parts and a count past twelve. */
export const MORE_NOTES: api.EpochNote[] = [
  {
    sheet: "items.materials",
    row: "cinder-ore",
    name: "Cinder ore",
    column: "tags",
    change: "changed",
    before: "ember, heavy",
    after: "ember, heavy, keen",
    unit: "tags",
  },
  {
    sheet: "growth.xp-by-deed",
    row: "craft",
    column: "xp",
    change: "changed",
    before: "10",
    after: "12",
    unit: "xp",
  },
  {
    sheet: "settlements.guild-works",
    row: "smelter",
    column: "uses",
    change: "changed",
    before: '[{"asset":"cinder-ore","units":4}]',
    after: '[{"asset":"cinder-ore","units":5}]',
    unit: "parts",
  },
  {
    sheet: "liveops.contests",
    row: "haul-week",
    column: "most",
    change: "changed",
    before: "20",
    after: "25",
    unit: "count",
  },
  {
    sheet: "wear.params",
    row: "repair-days",
    column: "value",
    change: "changed",
    before: "3",
    after: "1",
    unit: "days",
  },
];

const fact = (id: number, season: number, from: string, to: string): api.Fact => ({
  id,
  tick: 2016,
  kind: "season.epoch",
  subjects: [],
  data: [
    { k: "season", n: season },
    { k: "from", s: from },
    { k: "to", s: to },
    { k: "sheets", n: 9 },
  ],
  weight: 70,
});

/** A season.epoch event with its first n notes, from NOTES then MORE_NOTES, and unseen hidden ones. */
export function epoch(id: number, n: number, unseen: number, season = 1): api.StoryEvent {
  return {
    fact: fact(id, season, FROM, TO),
    art: ART,
    epoch: {
      season,
      from: FROM,
      to: TO,
      sheets: 9,
      seen: [...NOTES, ...MORE_NOTES].slice(0, n),
      unseen,
    },
  };
}

/** The epochs a chronicle channel may be told: no seen note, a few, more than the card lists. */
export const epochs: [string, api.StoryEvent][] = [
  ["only changes nobody sees", epoch(1501, 0, 5)],
  ["three notes, nothing hidden", epoch(1502, 3, 0)],
  ["three notes and seven hidden", epoch(1503, 3, 7)],
  ["fourteen notes, a hidden one", epoch(1504, 14, 1)],
  ["every kind of note", epoch(1505, NOTES.length + MORE_NOTES.length, 23, 2)],
  [
    "notes the world did not store",
    { fact: fact(1506, 1, FROM, TO), art: ART } satisfies api.StoryEvent,
  ],
  ["without the art", { ...epoch(1507, 3, 2), art: undefined }],
];

/** A roll-key step alone: the same book, which the card never tells. */
export const rollOnly: api.StoryEvent = {
  fact: fact(1508, 1, FROM, FROM),
  epoch: { season: 1, from: FROM, to: FROM, sheets: 0, seen: [], unseen: 0 },
};

/** The cards of this milestone, for the card standard's test. */
export function mm14Cards(lex: Lexicon): [string, () => Card][] {
  return [
    ...epochs.map(([name, ev]): [string, () => Card] => [
      `chronicle channel: the rules epoch, ${name}`,
      () => promotionCard(ev, lex)!,
    ]),
    ["forget me, the question", () => forgetAskCard(7)],
    [
      "forget me, asked again after the world moved on",
      () => forgetAskCard(8, "The world moved on: here is the card as it stands."),
    ],
    ["forget me, done", () => forgetDoneCard(true, "cleared")],
    ["forget me, done but the bot's notes stayed", () => forgetDoneCard(true, "failed")],
    ["forget me, nothing to forget", () => forgetDoneCard(false, "cleared")],
  ];
}
