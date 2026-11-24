import { describe, expect, test } from "bun:test";

import { toMessage } from "../../../packages/discord-kit/src/index.ts";
import { ALT_MAX, chartMarks, markLabel } from "../../../packages/mmo-words/src/alt.ts";
import type * as api from "../src/api.ts";
import { type Card, problems, render } from "../src/card.ts";
import { Lexicon } from "../src/lexicon.ts";
import { promotionCard } from "../src/screens/emergence.ts";
import { beatCard } from "../src/screens/fight.ts";
import { huntCard, huntClosedCard, huntPostCard } from "../src/screens/hunt.ts";
import { historyCard, markedFields, reportCard } from "../src/screens/market.ts";
import { partyBeatCard } from "../src/screens/party.ts";
import { chronicleCard, eventCard } from "../src/screens/story.ts";
import * as mm8 from "./fixtures/mm8.ts";
import * as mm9 from "./fixtures/mm9.ts";
import * as mm10 from "./fixtures/mm10.ts";
import samples from "./fixtures/world.json";

const w = samples as unknown as Record<string, unknown>;
const NUMBERS: api.Numbers = {
  ambushLine: 600,
  overrunLine: 900,
  crawlTicks: 6,
  woundedTicks: 1,
  freeTicks: 2,
  stepMin: 1,
  stepMax: 3,
  beatsMin: 3,
  beatsMax: 6,
  ruinTroubles: 3,
  cityStationCap: 3,
  roadEnterTicks: 1,
  campTier: 1,
  mastersEase: 1,
  customSeasons: 3,
};
const lex = new Lexicon(
  mm10.lexicon({
    ...(w.lexicon as Omit<api.Lexicon, "numbers">),
    numbers: NUMBERS,
    starts: ["hook", "knife", "deck"],
  }),
);
const names = lex.goodsNames();
const o = w.options as api.Options;
const here = w.here as api.Here;
const fighting = w["options:fight"] as api.Options;
const market = w.market as api.Market;
const history = w.history as api.History;

const PORTRAIT = "portrait-0123456789ab";
const portrayed = (x: api.Options): api.Options => ({
  ...x,
  fight: { ...x.fight!, portrait: PORTRAIT },
});
const art = (slot: string): api.Art => ({ key: `art-${slot}`, slot });

const priced: api.History = {
  ...history,
  days: [
    { day: 3, close: 12, units: 4 },
    { day: 4, close: 15, units: 6, cause: "trouble started near Pylon Camp" },
    { day: 5, close: 14, units: 2 },
    { day: 6, close: 9, units: 9, cause: "arc stage-ended near Pylon Camp" },
    { day: 7, close: 11, units: 3, cause: "trouble held near Greywater" },
  ],
};

const report: api.Market = {
  ...market,
  report: {
    day: 14,
    supply: 40210,
    active: 102,
    perActive: 394,
    low: 350,
    high: 450,
    rate: 60,
    velocity: 12,
    faucet: 41000,
    fees: 1203,
    top: [{ material: market.material, units: 310 }],
    every: 7,
    audit: 0,
    chart: "chart-supply",
  },
};

/** The kinds the events channel tells over their art slot. */
const ART_KINDS = new Set([
  "trouble.started",
  "trouble.held",
  "trouble.lost",
  "arc.cast",
  "arc.stage-began",
  "arc.stage-ended",
  "arc.ended",
  "season.began",
  "season.finale",
  "season.closed",
]);

const arted = [...mm9.events, ...mm10.events, ["a season's close", mm10.seasonClosed] as const]
  .filter(([, ev]) => ART_KINDS.has(ev.fact.kind))
  .map(([name, ev]): [string, api.StoryEvent] => [name, { ...ev, art: art("stage-held") }]);

/** Every card MM11 puts a new picture or thumb on. */
const CARDS: [string, () => Card][] = [
  ["a beat with its portrait", () => beatCard(portrayed(fighting), here, lex)],
  [
    "a party beat with its portrait",
    () => partyBeatCard(portrayed(mm8.shared), mm8.inDungeon, mm8.choosing, lex),
  ],
  [
    "a live hunt with its portrait",
    () => huntCard(o, here, { ...mm8.hunt, portrait: PORTRAIT }, mm8.huntView, lex),
  ],
  ["a hunt's post with its portrait", () => huntPostCard({ ...mm8.hunt, portrait: PORTRAIT }, lex)],
  [
    "a slain hunt with its portrait",
    () => huntClosedCard({ ...mm8.huntSlain, portrait: PORTRAIT }, lex),
  ],
  [
    "the chronicle over its cover",
    () => chronicleCard({ ...mm9.chronicle, cover: art("day") }, lex, 0, true),
  ],
  [
    "the private chronicle over its cover",
    () => chronicleCard({ ...mm9.chronicle, cover: art("raid") }, lex, 4),
  ],
  ...arted.map(([name, ev]): [string, () => Card] => [
    `events channel over its art: ${name}`,
    () => eventCard(ev, lex)!,
  ]),
  ["price history with marks", () => historyCard(o, market, priced, lex)],
  ["ledger report with its chart", () => reportCard(o, report, lex)],
];

describe("every new picture and thumb carries its media key and alt", () => {
  test.each(CARDS)("%s", (_, make) => {
    const card = make();
    expect(problems(card, names)).toEqual([]);
    const r = render(card);
    expect(r.media.length).toBeGreaterThan(0);
    for (const m of r.media) {
      expect(m.key).not.toBe("");
      expect(m.alt.trim()).not.toBe("");
      expect(m.alt.length).toBeLessThanOrEqual(ALT_MAX);
    }
    const embed = r.message.embeds[0]!;
    if (card.picture !== "form") expect(embed.image).toBe(`attachment://${card.picture.media}.png`);
    if (card.thumb) expect(embed.thumbnail).toBe(`attachment://${card.thumb.media}.png`);
  });
});

describe("portraits", () => {
  test("a beat shows the portrait as its thumb, and the banner stays the picture", () => {
    const card = beatCard(portrayed(fighting), here, lex);
    expect(card.thumb?.media).toBe(PORTRAIT);
    expect(card.thumb?.alt).toStartWith("Portrait of ");
    expect(card.picture).not.toBe("form");
    expect(card.picture !== "form" && card.picture.media).toBe(here.banner);
    expect(render(card).media.map((m) => m.key)).toEqual([here.banner, PORTRAIT]);
  });

  test("a variant's portrait names the variant", () => {
    const card = beatCard(
      { ...mm10.onVariant, fight: { ...mm10.onVariant.fight!, portrait: PORTRAIT } },
      here,
      lex,
    );
    const f = mm10.onVariant.fight!;
    expect(card.thumb?.alt).toContain(lex.name("creatures.variants", f.variant!).toLowerCase());
  });

  test("no portrait, no thumb: the card is as before", () => {
    expect(beatCard(fighting, here, lex).thumb).toBeUndefined();
    expect(partyBeatCard(mm8.shared, mm8.inDungeon, mm8.choosing, lex).thumb).toBeUndefined();
    expect(huntPostCard(mm8.hunt, lex).thumb).toBeUndefined();
  });

  test("a picture and a thumb of one key attach one file", () => {
    const card = beatCard(portrayed(fighting), here, lex);
    const same = { ...card, thumb: { media: here.banner, alt: "the same picture" } };
    expect(render(same).media).toHaveLength(1);
  });
});

describe("art and covers", () => {
  test("an event of an art kind is drawn over its slot, with the slot's words", () => {
    const [, ev] = arted.find(([, e]) => e.fact.kind === "arc.stage-ended")!;
    const card = eventCard({ ...ev, art: art("stage-lost") }, lex)!;
    expect(card.picture).toEqual({
      media: "art-stage-lost",
      alt: expect.stringContaining("A stage lost"),
    });
  });

  test("an event the world sent no art for stays a form", () => {
    for (const [, ev] of mm9.events) expect(eventCard(ev, lex)?.picture ?? "form").toBe("form");
  });

  test("a place event keeps no picture even with art sent", () => {
    const [, ev] = mm9.events.find(([, e]) => e.fact.kind === "city.fell-back")!;
    expect(eventCard({ ...ev, art: art("day") }, lex)!.picture).toBe("form");
  });

  test("the chronicle is a form without a cover", () => {
    expect(chronicleCard(mm9.chronicle, lex, 0, true).picture).toBe("form");
    expect(chronicleCard(mm9.unwritten, lex, 0, true).picture).toBe("form");
  });

  test("MM10's promotion poster keeps its form", () => {
    for (const [, ev] of mm10.promotions)
      expect(promotionCard({ ...ev, art: art("fair") }, lex)?.picture).toBe("form");
  });
});

describe("charts", () => {
  test("the Marked field keys A, B, C to the days with a cause, in day order", () => {
    const card = historyCard(o, market, priced, lex);
    const marked = card.fields?.filter((f) => f.name.startsWith("Marked")) ?? [];
    expect(marked.map((f) => f.name)).toEqual(["Marked"]);
    const lines = marked[0]!.value.split("\n");
    expect(lines).toEqual([
      "**A** day 4, 15 coin: trouble started near Pylon Camp",
      "**B** day 6, 9 coin: arc stage-ended near Pylon Camp",
      "**C** day 7, 11 coin: trouble held near Greywater",
    ]);
    const alt = card.picture !== "form" ? card.picture.alt : "";
    expect(alt).toContain("A on day 4, B on day 6 and C on day 7");
    expect(alt).toContain("in coin per Chips");
  });

  test("a chart with no cause has no Marked field", () => {
    const card = historyCard(o, market, history, lex);
    expect(card.fields ?? []).toEqual([]);
  });

  test("the letters run past Z as the world's do, and long keys split across fields", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(markLabel)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
    ]);
    const days = Array.from({ length: 30 }, (_, i) => ({
      day: i + 1,
      close: 10,
      units: 1,
      cause: `trouble started near a place with a long name ${"x".repeat(40)}`,
    }));
    const fields = markedFields(days);
    expect(fields.length).toBeGreaterThan(1);
    expect(fields[1]!.name).toBe("Marked, continued");
    for (const f of fields) expect(f.value.length).toBeLessThanOrEqual(1024);
    expect(fields.flatMap((f) => f.value.split("\n"))).toHaveLength(30);
    expect(chartMarks(days).at(-1)!.label).toBe("AD");
  });

  test("the ledger report's alt names its band and where the line ends", () => {
    const card = reportCard(o, report, lex);
    const alt = card.picture !== "form" ? card.picture.alt : "";
    expect(alt).toContain("band from 350 to 450 coin per active character");
    expect(alt).toContain("ends on day 14 at 394 coin per active character");
  });
});

describe("the alt rules", () => {
  const base: Card = {
    context: "Only you can see this",
    author: "Test",
    title: "A card",
    picture: { media: "m", alt: "a picture" },
    footer: "f",
    rows: [],
  };

  test("problems() fails a thumb without alt", () => {
    expect(problems({ ...base, thumb: { media: "t", alt: " " } }, names)).toEqual([
      "a thumbnail without alt text",
    ]);
  });

  test("problems() fails any alt over 1,024 characters", () => {
    const long = "a".repeat(ALT_MAX + 1);
    expect(problems({ ...base, picture: { media: "m", alt: long } }, names)).toHaveLength(1);
    expect(problems({ ...base, thumb: { media: "t", alt: long } }, names)).toHaveLength(1);
    expect(problems({ ...base, thumb: { media: "t", alt: "a".repeat(ALT_MAX) } }, names)).toEqual(
      [],
    );
  });

  test("toMessage clamps attachment descriptions to 1,024 characters", () => {
    const json = toMessage({
      embeds: [],
      rows: [],
      files: [
        { name: "a.png", data: new Uint8Array([1]), description: "d".repeat(3000) },
        { name: "b.png", data: new Uint8Array([2]), description: "short" },
        { name: "c.png", data: new Uint8Array([3]) },
      ],
    });
    expect(json.files?.map((f) => f.description?.length)).toEqual([1024, 5, undefined]);
  });
});
