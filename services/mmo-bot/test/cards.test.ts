import { describe, expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { bareNumbers, type Card, problems, render } from "../src/card.ts";
import { forumCard } from "../src/forum.ts";
import { Lexicon } from "../src/lexicon.ts";
import { beatCard, downCard, fieldCard, resolvedCard, whyCard } from "../src/screens/fight.ts";
import { hubCard, recapCard, startCard, whereCard } from "../src/screens/hub.ts";
import {
  appraisalCard,
  characterCard,
  craftCard,
  itemCard,
  madeCard,
  recipesCard,
} from "../src/screens/make.ts";
import {
  bookCard,
  elsewhereCard,
  exchangeCard,
  gearCard,
  historyCard,
  mineCard,
  moversCard,
  orderForm,
  ordersCard,
  reportCard,
} from "../src/screens/market.ts";
import { talkCard } from "../src/screens/talk.ts";
import { travelCard } from "../src/screens/travel.ts";
import samples from "./fixtures/world.json";

/** Every card the bot draws, from replies a scripted run recorded off a real world, keeps the card standard (card.ts problems()). */

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
};
const lex = new Lexicon({
  ...(w.lexicon as Omit<api.Lexicon, "numbers">),
  numbers: NUMBERS,
  starts: ["hook", "knife", "deck"],
});
const names = lex.goodsNames();
const o = w.options as api.Options;
const here = w.here as api.Here;
const sheet = w.sheet as api.Sheet;
const recipes = w.recipes as api.Recipes;
const press = (w["act:press"] as { reply: api.ActionReply }).reply;
const craft = (w["act:craft"] as { reply: api.ActionReply }).reply;
const market = w.market as api.Market;

const cards: [string, () => Card][] = [
  ["start", () => startCard(lex)],
  ["hub", () => hubCard(o, here, sheet, lex)],
  ["where", () => whereCard(o, here, lex)],
  [
    "travel",
    () =>
      travelCard(
        o,
        w.map as api.MapView,
        here,
        lex,
        NUMBERS.ambushLine,
        w.routeRisk as api.RouteRisk,
      ),
  ],
  [
    "travel on the road",
    () =>
      travelCard(
        (w["options:travel"] ?? o) as api.Options,
        w.map as api.MapView,
        here,
        lex,
        NUMBERS.ambushLine,
      ),
  ],
  ["field", () => fieldCard(o, here, lex)],
  ["beat", () => beatCard(w["options:fight"] as api.Options, here, lex)],
  [
    "beat after a press",
    () =>
      beatCard(w["options:fight"] as api.Options, here, lex, {
        pressed: press.pressed ?? [],
        facts: press.facts,
      }),
  ],
  ["resolved", () => resolvedCard(o, here, lex, press.pressed ?? [], press.facts)],
  ["why options", () => whyCard(w["options:fight"] as api.Options, here, lex, "options")],
  ["why moves", () => whyCard(o, here, lex, "moves")],
  ["down", () => downCard((w["options:down"] ?? o) as api.Options, here, lex)],
  ["craft", () => craftCard(o, here, sheet, recipes, lex, {})],
  [
    "craft chosen",
    () =>
      craftCard(o, here, sheet, recipes, lex, {
        process: "shape",
        method: "narrow-grind",
        slot: "tool",
      }),
  ],
  [
    "appraisal",
    () =>
      appraisalCard(o, here, w.appraise as api.Appraisal, lex, {
        process: "shape",
        method: "narrow-grind",
        slot: "tool",
        material: "x",
        qty: 2,
      }),
  ],
  ["made", () => madeCard(o, here, craft.facts, lex)],
  ["the book", () => bookCard(o, market, lex)],
  ["exchange", () => exchangeCard(o, market, lex)],
  ["movers", () => moversCard(o, market, lex)],
  ["price history", () => historyCard(o, market, w.history as api.History, lex)],
  ["elsewhere", () => elsewhereCard(o, market, lex)],
  ["gear listings", () => gearCard(o, market, lex)],
  ["faction orders", () => ordersCard(o, market, lex)],
  ["mine", () => mineCard(o, market, lex)],
  ["ledger report", () => reportCard(o, market, lex)],
  [
    "ledger report with figures",
    () =>
      reportCard(
        o,
        {
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
            chart: market.banner,
          },
        },
        lex,
      ),
  ],
  [
    "gear listings with a piece",
    () =>
      gearCard(
        o,
        {
          ...market,
          gear: [
            {
              id: "l-9",
              kind: "k",
              name: "Hide scraps tool",
              slot: "tool",
              level: 3,
              picks: 0,
              durability: 40,
              max: 60,
              maker: "c-2",
              seller: "c-2",
              price: 30,
              value: 25,
              mine: false,
              sigil: "",
            },
          ],
          wants: [{ id: "w-1", what: "tool", price: 20, floor: { level: 2 }, mine: false }],
        },
        lex,
      ),
  ],
  [
    "order form",
    () => orderForm(o, market, { material: market.material, side: "bid", price: 9, units: 5 }, lex),
  ],
  ["character", () => characterCard(o, here, sheet, lex)],
  ["item", () => itemCard(o, here, [...sheet.kit, ...sheet.pack][0]!, lex)],
  [
    "item to wear",
    () =>
      itemCard(
        o,
        here,
        { ...[...sheet.kit, ...sheet.pack][0]!, worn: "", wearIn: ["hand", "off-hand"] },
        lex,
      ),
  ],
  [
    "damaged two-slot item at a market",
    () => {
      const it = [...sheet.kit, ...sheet.pack][0]!;
      const card = itemCard(
        { ...o, purse: { ...o.purse, market: true } },
        here,
        {
          ...it,
          worn: "",
          mount: undefined,
          wearIn: ["hand", "off-hand"],
          durability: Math.max(1, it.max - 5),
        },
        lex,
      );
      const ids = card.rows.flatMap((r) =>
        "buttons" in r ? r.buttons.map((b) => ("customId" in b ? b.customId : "")) : [],
      );
      expect(ids.some((id) => id.startsWith("mm|sell-item|"))).toBe(true);
      return card;
    },
  ],
  ["recipes", () => recipesCard(o, here, recipes, lex)],
  [
    "since you left",
    () =>
      recapCard(
        o,
        here,
        (w.recap ?? { since: 0, tick: 9, lines: [], more: 0 }) as api.Recap,
        lex,
        new Map(),
      ),
  ],
  ["conversation", () => talkCard(o, w.npc as api.Conversation)],
  [
    "market forum",
    () => forumCard((w.forum as api.Forum).posts[0]!, (w.forum as api.Forum).day, lex),
  ],
];

describe("every card keeps the card standard", () => {
  for (const [name, make] of cards) {
    test(name, () => {
      const card = make();
      expect(problems(card, names)).toEqual([]);
      const r = render(card);
      if (card.picture !== "form") expect(r.media.length).toBeGreaterThan(0);
      expect(r.message.content).toStartWith("-# ");
    });
  }
});

describe("the checker fails what breaks the standard", () => {
  const base: Card = {
    context: "x",
    author: "Test",
    title: "T",
    picture: { media: "m", alt: "a" },
    footer: "f",
    rows: [],
  };
  test("a bare number", () => {
    expect(problems({ ...base, description: "You carry 14 of them." }, names)).toHaveLength(1);
    expect(
      problems(
        { ...base, description: "You carry 14 coin, 3 hide scraps and level 4 gear." },
        new Set(["hide scraps"]),
      ),
    ).toEqual([]);
  });
  test("no picture on a card that is not a form", () => {
    expect(problems({ ...base, picture: { media: "m", alt: "" } }, names)).toHaveLength(1);
  });
  test("a modifier without a why button, an option without a band", () => {
    const p = problems(
      {
        ...base,
        modifiers: true,
        failable: ["Strike"],
        rows: [{ buttons: [{ kind: "page", label: "Strike", customId: "mm|press|strike|1" }] }],
      },
      names,
    );
    expect(p).toHaveLength(2);
  });
  test("rows Discord would cut", () => {
    const b = (id: string) => ({ kind: "page" as const, label: "Go", customId: id });
    const p = problems(
      {
        ...base,
        rows: [
          { buttons: [b("mm|a||1"), b("mm|a||1")] },
          {
            select: {
              customId: "mm|s||1",
              placeholder: "p",
              options: [
                { label: "x", value: "v" },
                { label: "y", value: "v" },
              ],
            },
          },
          ...Array.from({ length: 4 }, (_, i) => ({ buttons: [b(`mm|r|${i}|1`)] })),
        ],
      },
      names,
    );
    expect(p).toHaveLength(3);
  });
  test("changes, bands and identifiers are not bare", () => {
    expect(
      bareNumbers("70 to 64 of 90 durability; Even (about 1 in 2); fact #88,301; 3% fee", names),
    ).toEqual([]);
  });
});
