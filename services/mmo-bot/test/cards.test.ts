import { describe, expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { bareNumbers, type Card, problems, render } from "../src/card.ts";
import { Lexicon } from "../src/lexicon.ts";
import { beatCard, downCard, fieldCard, resolvedCard, whyCard } from "../src/screens/fight.ts";
import { hubCard, recapCard, startCard, whereCard } from "../src/screens/hub.ts";
import {
  appraisalCard,
  characterCard,
  craftCard,
  itemCard,
  madeCard,
  marketCard,
  recipesCard,
} from "../src/screens/make.ts";
import { talkCard } from "../src/screens/talk.ts";
import { travelCard } from "../src/screens/travel.ts";
import samples from "./fixtures/world.json";

/**
 * MM4.23: every card the bot draws, from replies a scripted run recorded
 * off a real world, keeps the card standard: a picture unless a pure form,
 * no number without its unit, a why button where a modifier shows, and a
 * band on every option that can fail.
 */

const w = samples as unknown as Record<string, unknown>;
const lex = new Lexicon(w.lexicon as api.Lexicon);
const names = lex.goodsNames();
const o = w.options as api.Options;
const here = w.here as api.Here;
const sheet = w.sheet as api.Sheet;
const recipes = w.recipes as api.Recipes;
const press = (w["act:press"] as { reply: api.ActionReply }).reply;
const craft = (w["act:craft"] as { reply: api.ActionReply }).reply;

const cards: [string, () => Card][] = [
  ["start", () => startCard()],
  ["hub", () => hubCard(o, here, sheet, lex)],
  ["where", () => whereCard(o, here, lex)],
  ["travel", () => travelCard(o, w.map as api.MapView, here, lex, 600)],
  [
    "travel on the road",
    () =>
      travelCard((w["options:travel"] ?? o) as api.Options, w.map as api.MapView, here, lex, 600),
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
  ["down", () => downCard((w["options:down"] ?? o) as api.Options, here)],
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
  ["market", () => marketCard(o, here, sheet, lex)],
  ["character", () => characterCard(o, here, sheet, lex)],
  ["item", () => itemCard(o, here, [...sheet.kit, ...sheet.pack][0]!, lex)],
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
  test("changes, bands and identifiers are not bare", () => {
    expect(
      bareNumbers("70 to 64 of 90 durability; Even (about 1 in 2); fact #88,301; 3% fee", names),
    ).toEqual([]);
  });
});
