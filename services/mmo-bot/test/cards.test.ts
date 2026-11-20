import { describe, expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { bareNumbers, type Card, problems, render } from "../src/card.ts";
import { boardPostCard, forumCard } from "../src/forum.ts";
import { Lexicon } from "../src/lexicon.ts";
import { classesCard } from "../src/screens/classes.ts";
import { beatCard, downCard, fieldCard, resolvedCard, whyCard } from "../src/screens/fight.ts";
import {
  BLANK,
  boardCard,
  fromSpec,
  goalCard,
  goalDraftId,
  goalDraftOf,
  goalForm,
} from "../src/screens/goals.ts";
import { guildCard } from "../src/screens/guild.ts";
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
const goals = w.goals as api.Goals;
const posted = (w.board as api.Board).posts[0]!;
const guild = w.guild as api.Guild;
const classes = w.classes as api.Classes;
/** The recorded goal as each kind of goal the card words differently. */
const goalAs = (over: Partial<api.Goal>): api.Goal => ({ ...posted.goal, ...over });
const down: api.Options = { ...((w["options:down"] ?? o) as api.Options) };

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
  ["notice board, empty", () => boardCard(o, { ...goals, board: [] })],
  [
    "notice board",
    () =>
      boardCard(o, {
        ...goals,
        board: [
          posted.goal,
          goalAs({ id: "q-8", state: "proposed", need: 100, pledged: 40, left: 0 }),
          goalAs({ id: "q-9", vow: false, reward: 250, progress: 3, count: 10, left: 13 }),
        ],
      }),
  ],
  ["goal", () => goalCard(o, goals, posted.goal, lex)],
  [
    "goal, pooled with deliveries and a haul",
    () =>
      goalCard(
        { ...o, purse: { ...o.purse, coin: 500 } },
        goals,
        goalAs({
          vow: false,
          mode: "pooled",
          reward: 250,
          count: 40,
          progress: 12,
          claims: 2,
          left: 30,
          top: [{ who: "c-2", units: 8 }],
          takes: [{ material: "cinder-ore", units: 6 }],
          haul: "take",
          hauler: "c-3",
          building: "wall",
          where: "Copper Camp",
        }),
        lex,
      ),
  ],
  [
    "goal, proposed by a settlement",
    () =>
      goalCard(
        { ...o, purse: { ...o.purse, coin: 500 } },
        goals,
        goalAs({ state: "proposed", issuer: "settlement", need: 100, pledged: 40, vow: false }),
        lex,
      ),
  ],
  [
    "goal, each with a cap",
    () => goalCard(o, goals, goalAs({ mode: "each", cap: 10, reward: 25, vow: false }), lex),
  ],
  [
    "a rescue goal and who answers",
    () =>
      goalCard(
        o,
        goals,
        goalAs({
          title: "Carry c-7 home",
          verb: "carry",
          what: "carry c-7 to Copper Camp",
          reward: 30,
          vow: false,
          count: 1,
          left: 5,
          top: [{ who: "c-2", units: 1 }],
        }),
        lex,
      ),
  ],
  [
    "a goal met by facts",
    () =>
      goalCard(
        o,
        goals,
        goalAs({
          state: "done",
          reward: 50,
          vow: false,
          progress: 40,
          count: 40,
          claims: 1,
          paid: [{ who: "c-2", units: 40, coin: 50, cited: 4, facts: craft.facts.slice(0, 2) }],
        }),
        lex,
      ),
  ],
  [
    "notice board with goals met lately",
    () => boardCard(o, { ...goals, met: [goalAs({ id: "q-4", state: "done" })] }),
  ],
  ["goal form, blank", () => goalForm(o, goals, BLANK)],
  ...goals.targets.map((t): [string, () => Card] => [
    `goal form, ${t.verb}`,
    () =>
      goalForm(
        o,
        { ...goals, officer: true },
        {
          ...BLANK,
          verb: t.verb,
          target: t.options[0]?.value ?? "-",
          mode: "e",
          issuer: "s",
          reward: 50,
        },
      ),
  ]),
  ...goals.drafts.map((d, i): [string, () => Card] => [
    `goal form, suggested draft ${i}`,
    () => goalForm(o, goals, fromSpec(d.spec)),
  ]),
  ["notice-board forum post", () => boardPostCard(posted, lex)],
  ["guild members", () => guildCard(o, guild, lex)],
  [
    "guild members, an officer with a payment to approve and a vote open",
    () =>
      guildCard(
        { ...o, purse: { ...o.purse, coin: 50, goods: [{ material: "cinder-ore", units: 4 }] } },
        {
          ...guild,
          officer: true,
          full: true,
          spend: 120,
          bank: [{ material: "cinder-ore", units: 30 }],
          treasury: 900,
          near: [{ value: "c-9", label: "c-9" }],
          approvals: [{ id: "a-1", by: "c-2", to: "c-3", what: "coin", value: 400 }],
          votes: [{ target: "c-2", role: "officer", for: 2, need: 3 }],
          charter: { ...guild.charter, can: true, take: true },
        },
        lex,
      ),
  ],
  ["guild settlements", () => guildCard(o, guild, lex, "places")],
  [
    "guild settlements, an officer standing in one",
    () =>
      guildCard(
        o,
        {
          ...guild,
          officer: true,
          settlements: guild.settlements.map((s, i) => ({
            ...s,
            here: i === 0,
            structures: s.structures.map((x, j) =>
              j === 0 ? { ...x, tier: Math.max(1, x.tier), condition: 60 } : x,
            ),
          })),
        },
        lex,
        "places",
      ),
  ],
  ["guild works", () => guildCard(o, guild, lex, "works")],
  [
    "guild works, running",
    () =>
      guildCard(
        o,
        { ...guild, works: guild.works.map((x) => ({ ...x, can: true, on: true, days: 4 })) },
        lex,
        "works",
      ),
  ],
  [
    "no guild",
    () => guildCard(o, { ...guild, id: "", name: "", members: [], invites: ["g-2"] }, lex),
  ],
  ["classes", () => classesCard(o, classes)],
  ...classes.classes.map((c): [string, () => Card] => [
    `classes, ${c.id} earned and active`,
    () =>
      classesCard(
        o,
        {
          ...classes,
          active: 1,
          classes: classes.classes.map((x) =>
            x.id === c.id
              ? {
                  ...x,
                  earned: true,
                  active: true,
                  first: true,
                  level: 12,
                  tiers: x.tiers.map((t, i) => ({ ...t, open: i < 2 })),
                }
              : x,
          ),
        },
        c.id,
      ),
  ]),
  [
    "down, having called for help",
    () => downCard({ ...down, rescue: { called: true, home: "Copper Camp" } }, here, lex),
  ],
  [
    "down, carried",
    () =>
      downCard(
        { ...down, rescue: { called: true, home: "Copper Camp", carriedBy: "c-2" } },
        here,
        lex,
      ),
  ],
  [
    "where, with someone down",
    () =>
      whereCard(
        o,
        {
          ...here,
          downed: [
            { id: "c-7", name: "c-7", called: false },
            { id: "c-8", name: "c-8", called: true },
          ],
        },
        lex,
      ),
  ],
];

test("a goal draft survives its custom id, and a bad one is refused", () => {
  const d = {
    ...BLANK,
    verb: "haul",
    target: "cinder-ore>1",
    count: 40,
    reward: 250,
    mode: "p" as const,
  };
  expect(goalDraftOf(goalDraftId(d))).toEqual(d);
  for (const bad of ["", "9.x.1.1.f.e.x.c", "0.x.1.1.z.e.x.c", "0.x.one.1.f.e.x.c"])
    expect(goalDraftOf(bad)).toBeNull();
});

test("the one in need who called is the one offered to carry", () => {
  const card = whereCard(
    o,
    {
      ...here,
      downed: [
        { id: "c-7", name: "c-7", called: false },
        { id: "c-8", name: "c-8", called: true },
      ],
    },
    lex,
  );
  const labels = card.rows.flatMap((r) => ("buttons" in r ? r.buttons.map((b) => b.label) : []));
  expect(labels).toContain("Carry c-8 home");
  expect(labels).not.toContain("Carry c-7 home");
});

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

test("a met goal shows who claimed and the facts cited, and offers nothing to press but the board", () => {
  const card = goalCard(
    o,
    goals,
    goalAs({
      state: "done",
      reward: 50,
      vow: false,
      paid: [{ who: "c-2", units: 40, coin: 50, cited: 4, facts: craft.facts.slice(0, 1) }],
    }),
    lex,
  );
  expect(card.title).toStartWith("Met: ");
  expect(card.fields?.find((f) => f.name === "Claimed by")?.value).toBe(
    "c-2: 50 coin, citing 4 facts",
  );
  expect(card.description).toContain(`fact #${craft.facts[0]!.id}`);
  expect(card.rows.flatMap((r) => ("buttons" in r ? r.buttons.map((b) => b.label) : []))).toEqual([
    "Board",
  ]);
});

test("only an officer is offered to manage members; anyone may vote on an officer", () => {
  const options = (g: api.Guild) =>
    guildCard(o, g, lex)
      .rows.flatMap((r) => ("select" in r ? r.select.options : []))
      .map((x) => x.value);
  const members: api.GuildMember[] = [
    {
      id: "c-1",
      name: "c-1",
      leader: true,
      officer: true,
      admin: false,
      draw: false,
      put: 0,
      season: 0,
    },
    {
      id: "c-2",
      name: "c-2",
      leader: false,
      officer: false,
      admin: false,
      draw: false,
      put: 0,
      season: 0,
    },
  ];
  const g = { ...guild, members, treasury: 500, officers: 1, officersMax: 2, near: [] };
  expect(options({ ...g, officer: false })).toEqual(["vote:c-1:leader"]);
  expect(options({ ...g, officer: true })).toEqual([
    "pay:c-1:100",
    "vote:c-1:leader",
    "allow:c-2:1",
    "promote:c-2:-",
    "pay:c-2:100",
  ]);
});
