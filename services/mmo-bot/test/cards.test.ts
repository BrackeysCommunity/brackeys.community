import { describe, expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { bareNumbers, type Card, problems, render } from "../src/card.ts";
import { boardPostCard, forumCard } from "../src/forum.ts";
import { decodeId } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { classesCard } from "../src/screens/classes.ts";
import { beatCard, downCard, fieldCard, resolvedCard, whyCard } from "../src/screens/fight.ts";
import {
  BLANK,
  boardCard,
  fromSpec,
  goalCard,
  type GoalDraft,
  goalDraftId,
  goalDraftOf,
  goalForm,
  specOf,
} from "../src/screens/goals.ts";
import { bankCard, guildCard, leaveCard, memberCard, placesCard } from "../src/screens/guild.ts";
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
// The recorded pages predate a few served fields; they are filled in
// here until the fixture is recorded again.
const goals: api.Goals = {
  ...(w.goals as api.Goals),
  eachCap: 10,
  traits: [
    { value: "keen", label: "Keen" },
    { value: "tempered", label: "Tempered" },
  ],
  places: [{ value: "region:r-3", label: "Greywater" }],
  fields: ["cover", "elevation", "fertility", "moisture", "ore"].map((f) => ({
    value: f,
    label: f,
  })),
  vows: [
    { value: "blade", label: "no blade" },
    { value: "plate", label: "no plate" },
  ],
  party: [
    { value: "c-2", label: "c-2" },
    { value: "c-3", label: "c-3" },
  ],
  partyMost: 6,
  even: false,
  waiting: [],
  gauge: "threat",
  ephemeralLeast: 6,
  ephemeralMost: 432,
  gauges: ["threat", "scarcity", "unrest", "corruption", "prosperity"].map((id) => ({
    value: id,
    label: id,
    lines: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  })),
  sides: [
    { value: "below", label: "below" },
    { value: "above", label: "above" },
  ],
};
const posted = (w.board as api.Board).posts[0]!;
const recordedGuild = w.guild as api.Guild;
const guild: api.Guild = {
  ...recordedGuild,
  named: 0,
  drawShare: 50,
  bankHere: true,
  invites: [],
  bank: recordedGuild.bank.map((b) => ({ ...b, value: 20, draw: 0 })),
  members: recordedGuild.members.map((m) => ({
    ...m,
    canPromote: false,
    payGoods: false,
    removable: m.admin ? undefined : m.leader ? "leader" : m.officer ? "officer" : undefined,
  })),
  settlements: recordedGuild.settlements.map((s) => ({
    ...s,
    conditionMax: 100,
    structures: s.structures.map((x) => ({
      ...x,
      stands: x.tier > 0 || x.condition > 0 || x.closed,
      canRaise: x.tier < x.maxTier && !x.raising && (x.next?.length ?? 0) > 0,
      rewardMost: 0,
    })),
  })),
};
/** A stock of the bank, at 22 coin a unit. */
const ore = (units: number, draw = 0): api.BankStock => ({
  material: "cinder-ore",
  units,
  value: 22,
  draw,
});
const classes = w.classes as api.Classes;
/** A purse with coin, provisions and a good in it, and a bank in reach that holds a stock. */
const carrying: api.Options = {
  ...o,
  purse: { ...o.purse, coin: 340, provisions: 12, goods: [{ material: "cinder-ore", units: 4 }] },
};
const stocked: api.Guild = {
  ...guild,
  treasury: 900,
  bank: [ore(30, 7), { material: "provisions", units: 60, value: 3, draw: 0 }],
};
/** The guild as an officer standing in its first settlement, whose first structure may carry a reward. */
const raisable = (rewardMost: number): api.Guild => ({
  ...guild,
  officer: true,
  settlements: guild.settlements.map((s, i) => ({
    ...s,
    here: i === 0,
    structures: s.structures.map((x, j) => ({
      ...x,
      canRaise: j < 2,
      rewardMost: j === 0 ? rewardMost : 0,
      next: [
        { tag: "timber", quantity: 200 },
        { tag: "stone", quantity: 100 },
      ],
    })),
  })),
});
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
  ["notice board, empty", () => boardCard(o, { ...goals, board: [] }, lex)],
  [
    "notice board",
    () =>
      boardCard(
        o,
        {
          ...goals,
          board: [
            posted.goal,
            goalAs({ id: "q-8", state: "proposed", need: 100, pledged: 40, left: 0 }),
            goalAs({ id: "q-9", vow: false, reward: 250, progress: 3, count: 10, left: 13 }),
          ],
        },
        lex,
      ),
  ],
  [
    "notice board, with delivered goods waiting",
    () =>
      boardCard(
        o,
        {
          ...goals,
          waiting: [
            { place: "Copper Camp", goods: [{ material: "cinder-ore", units: 40 }] },
            {
              place: "the tile at 3,-2",
              goods: [
                { material: "cinder-ore", units: 20 },
                { material: "provisions", units: 5 },
              ],
            },
          ],
        },
        lex,
      ),
  ],
  [
    "goal, a vow to hold off a thing",
    () =>
      goalCard(
        o,
        goals,
        goalAs({
          verb: "hold",
          what: "hold off blade",
          count: 0,
          progress: 0,
          vow: true,
          reward: 0,
        }),
        lex,
      ),
  ],
  [
    "goal, pooled and paid evenly",
    () => goalCard(o, goals, goalAs({ mode: "pooled", even: true, reward: 90, vow: false }), lex),
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
    () => boardCard(o, { ...goals, met: [goalAs({ id: "q-4", state: "done" })] }, lex),
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
  ...goals.targets.map((t): [string, () => Card] => [
    `goal form, how a ${t.verb} runs`,
    () =>
      goalForm(
        o,
        { ...goals, officer: true, even: true },
        {
          ...BLANK,
          verb: t.verb,
          target: t.options[0]?.value ?? "-",
          mode: t.verb === "deliver" ? "p" : "e",
          cap: 3,
          even: true,
          reward: 50,
          page: "t",
        },
      ),
  ]),
  [
    "goal form, a blade with a trait",
    () => goalForm(o, goals, { ...BLANK, verb: "make", target: "blade", count: 1, narrow: "keen" }),
  ],
  [
    "goal form, a creature defeated in one region",
    () =>
      goalForm(o, goals, {
        ...BLANK,
        verb: "defeat",
        target: "reed-rat",
        count: 3,
        narrow: "region:r-3",
      }),
  ],
  [
    "goal form, a tile rich in ore",
    () => goalForm(o, goals, { ...BLANK, verb: "discover", count: 1, narrow: "ore", least: 70 }),
  ],
  ["goal form, a vow", () => goalForm(o, goals, { ...BLANK, verb: "vow", count: 0 })],
  [
    "goal form, a Hold of a gauge above a line",
    () =>
      goalForm(o, goals, {
        ...BLANK,
        verb: "hold",
        target: "region:r-3",
        count: 5,
        narrow: "prosperity",
        least: 600,
        below: false,
      }),
  ],
  [
    "goal form, how a party's capped Each runs for an hour",
    () =>
      goalForm(
        o,
        { ...goals, officer: true, even: true },
        {
          ...BLANK,
          target: "cinder-ore",
          mode: "e",
          cap: 3,
          issuer: "p",
          members: ["c-2"],
          ticks: 6,
          page: "t",
        },
      ),
  ],
  [
    "goal form, how a vow runs",
    () =>
      goalForm(o, goals, {
        ...BLANK,
        verb: "vow",
        target: "blade",
        count: 0,
        life: "s",
        page: "t",
      }),
  ],
  [
    "goal form, a party's",
    () =>
      goalForm(o, goals, {
        ...BLANK,
        target: "cinder-ore",
        issuer: "p",
        members: ["c-2"],
        page: "t",
      }),
  ],
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
          bank: [ore(30)],
          treasury: 900,
          near: [{ value: "c-9", label: "c-9" }],
          approvals: [
            { id: "a-1", by: "c-2", to: "c-3", what: "coin", value: 400, goods: false, can: true },
          ],
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
              j === 0
                ? {
                    ...x,
                    tier: Math.max(1, x.tier),
                    stands: true,
                    condition: 60,
                    repairs: [
                      { points: 25, cost: [{ tag: "timber", quantity: 5 }] },
                      { points: 40, cost: [{ tag: "timber", quantity: 8 }] },
                    ],
                  }
                : x,
            ),
          })),
        },
        lex,
        "places",
      ),
  ],
  [
    "guild settlements, with structures that wait",
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
              j % 2 ? { ...x, canRaise: false, waits: "a later milestone" } : x,
            ),
          })),
        },
        lex,
        "places",
      ),
  ],
  [
    "guild members, away from the bank",
    () =>
      guildCard(
        { ...o, purse: { ...o.purse, coin: 50, goods: [{ material: "cinder-ore", units: 4 }] } },
        { ...guild, bankHere: false, bank: [ore(30)] },
        lex,
      ),
  ],
  ["guild bank", () => guildCard(o, guild, lex, "bank")],
  [
    "guild bank, away from it",
    () => bankCard(carrying, { ...guild, bankHere: false, bank: [ore(30)] }, lex),
  ],
  [
    "guild bank, picking how much to give",
    () => bankCard(carrying, stocked, lex, { act: "give", asset: "provisions" }),
  ],
  [
    "guild bank, picking how much to draw",
    () => bankCard(carrying, stocked, lex, { act: "draw", asset: "cinder-ore" }),
  ],
  [
    "a guild member, an officer picking how much coin to pay",
    () => memberCard(o, { ...stocked, officer: true, spend: 120 }, "c-1", lex, undefined, "coin"),
  ],
  [
    "a guild member, an officer picking how much of a stock to pay",
    () =>
      memberCard(
        o,
        {
          ...stocked,
          officer: true,
          spend: 120,
          members: stocked.members.map((m) => ({ ...m, payGoods: true })),
        },
        "c-1",
        lex,
        undefined,
        "cinder-ore",
      ),
  ],
  [
    "guild settlements, an officer picking a raise's reward",
    () => {
      const g = raisable(250);
      return placesCard(o, g, lex, g.settlements[0]!.structures[0]!.kind);
    },
  ],
  ["guild works", () => guildCard(o, guild, lex, "works")],
  [
    "guild works, running",
    () =>
      guildCard(
        o,
        {
          ...guild,
          works: guild.works.map((x) => ({
            ...x,
            can: true,
            on: true,
            days: 4,
            spares: x.gives !== "threat" && x.gives !== "rest",
            ran: 9,
            used: 1260,
            gave: 310,
          })),
        },
        lex,
        "works",
      ),
  ],
  [
    "no guild",
    () =>
      guildCard(
        o,
        {
          ...guild,
          id: "",
          name: "",
          members: [],
          invites: [{ value: "g-2", label: "The Saltbinders" }],
        },
        lex,
      ),
  ],
  ["a guild member, to an officer", () => memberCard(o, { ...guild, officer: true }, "c-1", lex)],
  ["leaving a guild", () => leaveCard(o, guild)],
  [
    "leaving a guild as its last member",
    () => leaveCard(o, { ...guild, server: false, members: guild.members.slice(0, 1) }),
  ],
  [
    "goals, away from any board",
    () =>
      boardCard(
        o,
        {
          ...goals,
          settlement: -1,
          board: [],
          drafts: [],
          met: [],
          mine: [posted.goal],
          waiting: [{ place: "Copper Camp", goods: [{ material: "cinder-ore", units: 40 }] }],
        },
        lex,
      ),
  ],
  [
    "classes, a Stalker marking prey",
    () => classesCard(o, { ...classes, prey: { tags: ["pack", "wired", "small"], today: "pack" } }),
  ],
  [
    "appraisal, to a Master's eye",
    () =>
      appraisalCard(o, here, { ...(w.appraise as api.Appraisal), registered: false }, lex, {
        process: "shape",
      }),
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
  const full = {
    ...d,
    verb: "discover",
    target: "ore",
    issuer: "p" as const,
    narrow: "ore",
    least: 70,
    cap: 3,
    even: true,
    members: ["c-2", "c-3"],
    page: "t" as const,
    ticks: 36,
  };
  expect(goalDraftOf(goalDraftId(full))).toEqual(full);
  const held = {
    ...BLANK,
    verb: "hold",
    target: "region:r-3",
    count: 5,
    narrow: "prosperity",
    least: 600,
    below: false,
  };
  expect(goalDraftOf(goalDraftId(held))).toEqual(held);
  expect(goalDraftOf("0.x.1.1.fexcnwb.-.0.0.-.0")).not.toBeNull();
  for (const bad of [
    "",
    "0.x.1.1.f.e.x.c",
    "0.x.1.1.fexcnw.-.0.0.-",
    "9.x.1.1.fexcnwb.-.0.0.-.0",
    "0.x.1.1.zexcnwb.-.0.0.-.0",
    "0.x.one.1.fexcnwb.-.0.0.-.0",
    "0.x.1.1.fexc?wb.-.0.0.-.0",
    "0.x.1.1.fexcnw?.-.0.0.-.0",
    "0.x.1.1.fexcnwb.-.some.0.-.0",
    "0.x.1.1.fexcnwb.-.0.0.-.day",
    "0.x.1.1.fexcnwb.-.0.0.-.-6",
  ])
    expect(goalDraftOf(bad)).toBeNull();
});

/** Every draft a form's buttons and select options lead to. */
const leads = (card: Card): GoalDraft[] =>
  card.rows
    .flatMap((r) =>
      "buttons" in r
        ? r.buttons.map((b) => (b.kind === "page" ? decodeId(b.customId) : null))
        : r.select.options.map((x) => ({ action: "g-form", target: x.value })),
    )
    .map((x) => (x && x.action.startsWith("g-") ? goalDraftOf(x.target) : null))
    .filter((x): x is GoalDraft => !!x);

test("the form posts a vow, a narrowed goal, a capped Each and a party's goal as the sim takes them", () => {
  const spec = (d: Partial<GoalDraft>) => specOf({ ...BLANK, ...d }, goals, "T", "");
  expect(
    spec({ verb: "vow", target: "blade", count: 0, reward: 50, issuer: "s", life: "s" }),
  ).toEqual({
    title: "T",
    note: undefined,
    issuer: "character",
    cond: { verb: "hold", count: 0, tag: "blade" },
    reward: 0,
    mode: "first",
    lifetime: "season",
    turnover: "expire",
    ticks: undefined,
  });
  expect(spec({ verb: "make", target: "blade", count: 1, narrow: "keen" }).cond).toEqual({
    verb: "make",
    count: 1,
    tag: "blade",
    trait: "keen",
  });
  expect(
    spec({ verb: "defeat", target: "reed-rat", count: 3, narrow: "region:r-3" }).cond,
  ).toMatchObject({ kind: "reed-rat", at: "region:r-3" });
  expect(spec({ verb: "discover", count: 1, narrow: "ore", least: 80 }).cond).toMatchObject({
    field: "ore",
    atLeast: 80,
    within: goals.within,
  });
  expect(spec({ verb: "discover", count: 1, narrow: "ore", least: 80 }).cond.tag).toBeUndefined();
  expect(spec({ target: "cinder-ore", mode: "e", cap: 3 }).cap).toBe(3);
  expect(spec({ target: "cinder-ore", mode: "e", cap: 500 }).cap).toBe(goals.eachCap);
  expect(spec({ target: "cinder-ore", mode: "e" }).cap).toBe(goals.eachCap);
  expect(spec({ target: "cinder-ore", mode: "p", even: true }).even).toBe(true);
  expect(spec({ target: "cinder-ore", mode: "f", even: true }).even).toBeUndefined();
  const party = spec({ target: "cinder-ore", issuer: "p", members: ["c-2", "c-3"] });
  expect([party.issuer, party.members]).toEqual(["party", ["c-2", "c-3"]]);
  expect(spec({ target: "cinder-ore", issuer: "c", members: ["c-2"] }).members).toBeUndefined();
});

test("an ephemeral goal lasts as long as the form picked, inside what the board allows", () => {
  const spec = (d: Partial<GoalDraft>) =>
    specOf({ ...BLANK, target: "cinder-ore", ...d }, goals, "T", "");
  expect(spec({}).ticks).toBe(goals.ephemeral);
  expect(spec({ ticks: 36 }).ticks).toBe(36);
  expect(spec({ ticks: 36, life: "s" }).ticks).toBeUndefined();
  expect(spec({ verb: "vow", target: "blade", count: 0, ticks: 288 }).ticks).toBe(288);
  // The board's own draft keeps the time it suggested.
  const suggested = fromSpec({ ...spec({ ticks: 72 }), title: "T" });
  expect(suggested.ticks).toBe(72);
  expect(fromSpec(spec({ life: "n" })).ticks).toBe(0);

  const terms = (g: api.Goals, d: Partial<GoalDraft>) =>
    goalForm(o, g, { ...BLANK, target: "cinder-ore", page: "t", ...d });
  const turn = (card: Card) =>
    card.rows
      .flatMap((r) => ("buttons" in r ? r.buttons : []))
      .find((b) => b.label.startsWith("For: "));
  const next = (card: Card) => {
    const b = turn(card);
    return b?.kind === "page" ? goalDraftOf(decodeId(b.customId)!.target) : null;
  };
  expect(turn(terms(goals, {}))?.label).toBe("For: 1 day");
  expect(turn(terms(goals, { ticks: 6 }))?.label).toBe("For: 1 hour");
  expect(turn(terms(goals, { life: "s" }))).toBeUndefined();
  expect(turn(terms(goals, { verb: "vow", target: "blade", count: 0 }))?.label).toBe("For: 1 day");
  // Round the ladder from the usual day: every stop is inside the bounds, and it comes back.
  const seen: number[] = [];
  let d: GoalDraft = { ...BLANK, target: "cinder-ore", page: "t" };
  for (let i = 0; i < 12 && !seen.includes(d.ticks || goals.ephemeral); i++) {
    seen.push(d.ticks || goals.ephemeral);
    d = next(goalForm(o, goals, d))!;
  }
  expect(seen).toEqual([144, 288, 432, 6, 36, 72]);
  const short = { ...goals, ephemeralLeast: 36, ephemeralMost: 144 };
  expect(next(terms(short, {}))?.ticks).toBe(36);
  expect(next(terms(short, { ticks: 72 }))?.ticks).toBe(144);
  // One length allowed: nothing to pick.
  expect(turn(terms({ ...goals, ephemeralLeast: 144, ephemeralMost: 144 }, {}))).toBeUndefined();
});

test("a Hold is posted on the gauge, side and line the form picked from what the board serves", () => {
  const hold = { verb: "hold", target: "region:r-3", count: 5 };
  const spec = (d: Partial<GoalDraft>) => specOf({ ...BLANK, ...hold, ...d }, goals, "T", "");
  expect(spec({}).cond).toEqual({
    verb: "hold",
    count: 5,
    at: "region:r-3",
    gauge: goals.gauge,
    line: goals.line,
    below: true,
  });
  expect(spec({ narrow: "prosperity", least: 600, below: false }).cond).toEqual({
    verb: "hold",
    count: 5,
    at: "region:r-3",
    gauge: "prosperity",
    line: 600,
    below: undefined,
  });
  // A suggested Hold comes back as the form's draft, and posts as it was suggested.
  const drafted = spec({ narrow: "unrest", least: 300 });
  expect(fromSpec(drafted)).toMatchObject({ narrow: "unrest", least: 300, below: true });
  expect(specOf(fromSpec(drafted), goals, "T", "").cond).toEqual(drafted.cond);
  expect(fromSpec(spec({ below: false })).below).toBe(false);

  const regions: api.Goals = {
    ...goals,
    targets: [
      ...goals.targets.filter((t) => t.verb !== "hold"),
      { verb: "hold", options: goals.places },
    ],
  };
  const form = (d: Partial<GoalDraft>, g = regions) => goalForm(o, g, { ...BLANK, ...hold, ...d });
  const buttons = (card: Card) =>
    card.rows.flatMap((r) => ("buttons" in r ? r.buttons : [])).map((b) => b.label);
  const lines = (card: Card) =>
    card.rows.flatMap((r) =>
      "select" in r && decodeId(r.select.customId)?.action === "g-least" ? r.select.options : [],
    );
  const plain = form({});
  expect(plain.title).toBe("Hold 5 days: Greywater, below 700 threat");
  expect(buttons(plain)).toEqual(expect.arrayContaining(["Gauge: threat", "Side: below"]));
  expect(lines(plain).map((x) => x.label)).toEqual(
    [100, 200, 300, 400, 500, 600, 800, 900].map((n) => `Below ${n} threat`),
  );
  expect(problems(plain, names)).toEqual([]);
  // The gauge and the side turn through what is served; the line is the gauge's own.
  const turned = leads(plain);
  expect(turned.map((x) => x.narrow)).toContain("scarcity");
  expect(turned.some((x) => !x.below)).toBe(true);
  expect(turned.filter((x) => x.least).map((x) => x.least)).toEqual([
    100, 200, 300, 400, 500, 600, 800, 900,
  ]);
  const last = form({ narrow: "prosperity", least: 600, below: false });
  expect(last.title).toBe("Hold 5 days: Greywater, above 600 prosperity");
  expect(leads(last).map((x) => x.narrow)).toContain("threat");
  expect(lines(last)[0]?.label).toBe("Above 100 prosperity");
  // One gauge, one side: nothing to turn, and the line still picks.
  const one = form(
    {},
    { ...regions, gauges: goals.gauges.slice(0, 1), sides: goals.sides.slice(0, 1) },
  );
  expect(buttons(one).some((x) => x.startsWith("Gauge") || x.startsWith("Side"))).toBe(false);
  expect(lines(one)).toHaveLength(8);
  // No other verb shows them.
  expect(buttons(goalForm(o, goals, { ...BLANK, target: "cinder-ore" }))).not.toContain(
    "Gauge: threat",
  );
});

test("the form offers the party, the cap and even shares only where they apply, and nothing too long to press", () => {
  const terms = (g: api.Goals, d: Partial<GoalDraft>) =>
    goalForm(o, g, { ...BLANK, target: "cinder-ore", page: "t", ...d });
  const actions = (card: Card) =>
    card.rows.flatMap((r) =>
      "select" in r
        ? [decodeId(r.select.customId)!.action]
        : r.buttons.map((b) => b.label.split(":")[0]!),
    );
  expect(actions(terms(goals, {}))).not.toContain("g-cap");
  expect(actions(terms(goals, { mode: "e" }))).toContain("g-cap");
  expect(actions(terms(goals, { mode: "p" }))).not.toContain("Split");
  expect(actions(terms({ ...goals, even: true }, { mode: "p" }))).toContain("Split");
  expect(actions(terms({ ...goals, even: true }, { mode: "f" }))).not.toContain("Split");
  expect(actions(terms(goals, { issuer: "c" }))).not.toContain("g-party");
  expect(actions(terms(goals, { issuer: "p" }))).toContain("g-party");
  // Nobody stands here to name: the issuer never cycles to a party.
  const alone = leads(terms({ ...goals, party: [] }, {})).map((x) => x.issuer);
  expect(alone).not.toContain("p");
  expect(leads(terms(goals, {})).map((x) => x.issuer)).toContain("p");
  // A party goal waits for a member before it can be named.
  const canPost = (card: Card) =>
    card.rows
      .flatMap((r) => ("buttons" in r ? r.buttons : []))
      .some((b) => b.kind === "page" && b.label.startsWith("Name") && !b.disabled);
  expect(canPost(terms(goals, { issuer: "p" }))).toBe(false);
  expect(canPost(terms(goals, { issuer: "p", members: ["c-2"] }))).toBe(true);
  // Long ids: members are offered only while the draft still fits a custom id.
  const crowd = Array.from({ length: 20 }, (_, i) => ({
    value: `c-10000000${i}`,
    label: `c-10000000${i}`,
  }));
  let d: GoalDraft = { ...BLANK, target: "cinder-ore", issuer: "p", page: "t" };
  for (let i = 0; i < 20; i++) {
    const card = goalForm({ ...o, version: 123456 }, { ...goals, party: crowd, partyMost: 20 }, d);
    expect(problems(card, names)).toEqual([]);
    const more = leads(card).find((x) => x.members.length > d.members.length);
    if (!more) break;
    d = more;
  }
  expect(d.members.length).toBeGreaterThan(1);
  expect(d.members.length).toBeLessThan(20);
});

/** A card's selects by action: the values each offers. */
const selects = (card: Card): Record<string, string[]> =>
  Object.fromEntries(
    card.rows.flatMap((r) =>
      "select" in r
        ? [[decodeId(r.select.customId)!.action, r.select.options.map((x) => x.value)]]
        : [],
    ),
  );

test("goods go into and out of the bank only where it stands; coin from anywhere", () => {
  const base = (bankHere: boolean): api.Guild => ({
    ...guild,
    officer: true,
    bankHere,
    bank: [ore(30, 7)],
    // The world offers the approval of goods only at the bank.
    approvals: [
      {
        id: "a-1",
        by: "c-2",
        to: "c-3",
        what: "30 mat:cinder-ore",
        value: 600,
        goods: true,
        can: bankHere,
      },
    ],
  });
  const pressed = (g: api.Guild) =>
    guildCard(carrying, g, lex)
      .rows.flatMap((r) => ("buttons" in r ? r.buttons : []))
      .map((b) => (b.kind === "page" ? decodeId(b.customId) : null))
      .map((x) => `${x?.action}:${x?.target}`);
  expect(pressed(base(true))).toEqual(expect.arrayContaining(["gld-appr:a-1", "guild:bank"]));
  expect(pressed(base(false))).not.toContain("gld-appr:a-1");

  const at = selects(bankCard(carrying, base(true), lex));
  expect(at["gld-give"]).toEqual(["coin", "provisions", "cinder-ore"]);
  expect(at["gld-take"]).toEqual(["cinder-ore"]);
  const away = selects(bankCard(carrying, base(false), lex));
  expect(away["gld-give"]).toEqual(["coin"]);
  expect(away["gld-take"]).toBeUndefined();
  // A pick made at the bank is not kept away from it.
  for (const pick of [
    { act: "give", asset: "cinder-ore" },
    { act: "draw", asset: "cinder-ore" },
  ] as const) {
    const lost = selects(bankCard(carrying, base(false), lex, pick));
    expect(lost["gld-dep"]).toBeUndefined();
    expect(lost["gld-draw"]).toBeUndefined();
  }
});

test("the bank takes any amount of what is carried, and gives up to what the world says may be drawn", () => {
  const give = (asset: string) =>
    selects(bankCard(carrying, stocked, lex, { act: "give", asset }))["gld-dep"];
  expect(give("coin")).toEqual([1, 5, 10, 25, 50, 100, 250, 340].map((n) => `coin:${n}`));
  expect(give("provisions")).toEqual([1, 5, 10, 12].map((n) => `provisions:${n}`));
  expect(give("cinder-ore")).toEqual(["cinder-ore:1", "cinder-ore:4"]);
  // Nothing carried of it: no amount is offered.
  expect(give("timber")).toBeUndefined();

  const draw = bankCard(carrying, stocked, lex, { act: "draw", asset: "cinder-ore" });
  expect(selects(draw)["gld-take"]).toEqual(["cinder-ore"]);
  expect(selects(draw)["gld-draw"]).toEqual(["cinder-ore:1", "cinder-ore:5", "cinder-ore:7"]);
  const most = draw.rows
    .flatMap((r) => ("select" in r ? r.select.options : []))
    .find((x) => x.value === "cinder-ore:7");
  expect(most?.label).toBe("The most you may: 7 Scrap alloy");
  expect(most?.description).toBe("Costs 154 coin");
  // A stock the world lets this member draw none of is not offered.
  expect(
    selects(bankCard(carrying, stocked, lex, { act: "draw", asset: "provisions" }))["gld-draw"],
  ).toBeUndefined();
  expect(
    selects(bankCard(carrying, { ...stocked, bank: [ore(30)] }, lex))["gld-take"],
  ).toBeUndefined();
});

test("an officer pays a member coin from anywhere and goods only where the world says, any amount the guild holds", () => {
  const officer = (payGoods: boolean): api.Guild => ({
    ...stocked,
    officer: true,
    spend: 120,
    members: stocked.members.map((m) => ({ ...m, payGoods })),
  });
  const card = (g: api.Guild, pay?: string) => memberCard(o, g, "c-1", lex, undefined, pay);
  expect(selects(card(officer(true)))["gld-pay"]).toEqual(["coin", "cinder-ore", "provisions"]);
  expect(selects(card(officer(false)))["gld-pay"]).toEqual(["coin"]);
  expect(selects(card({ ...officer(true), officer: false }))["gld-pay"]).toBeUndefined();
  expect(selects(card({ ...officer(true), treasury: 0, bank: [] }))["gld-pay"]).toBeUndefined();

  const coin = card(officer(true), "coin");
  const amounts = coin.rows.flatMap((r) =>
    "select" in r && decodeId(r.select.customId)?.target === "pay:c-1:coin" ? r.select.options : [],
  );
  expect(amounts.map((x) => x.value)).toEqual([
    "1",
    "5",
    "10",
    "25",
    "50",
    "100",
    "250",
    "500",
    "900",
  ]);
  // Past what the officer may still pay today a payment waits for a second officer.
  expect(amounts.filter((x) => x.description === "Paid at once").map((x) => x.value)).toEqual([
    "1",
    "5",
    "10",
    "25",
    "50",
    "100",
  ]);
  expect(amounts.at(-1)).toMatchObject({
    label: "All: 900 coin",
    description: "Waits for a second officer",
  });
  const goods = card(officer(true), "cinder-ore").rows.flatMap((r) =>
    "select" in r && decodeId(r.select.customId)?.target === "pay:c-1:cinder-ore"
      ? r.select.options
      : [],
  );
  expect(goods.map((x) => [x.value, x.description])).toEqual([
    ["1", "Worth 22 coin. Paid at once"],
    ["5", "Worth 110 coin. Paid at once"],
    ["10", "Worth 220 coin. Waits for a second officer"],
    ["25", "Worth 550 coin. Waits for a second officer"],
    ["30", "Worth 660 coin. Waits for a second officer"],
  ]);
  // Goods picked for someone no longer at the bank: no amount is offered.
  expect(
    card(officer(false), "cinder-ore").rows.filter(
      (r) => "select" in r && decodeId(r.select.customId)?.action === "gld-act",
    ),
  ).toEqual([]);
});

test("a raise's goals carry no reward or one the world says the treasury and the officer's day cover", () => {
  const rewards = (most: number, pick = true) => {
    const g = raisable(most);
    const kind = g.settlements[0]!.structures[0]!.kind;
    return [kind, selects(placesCard(o, g, lex, pick ? kind : undefined))] as const;
  };
  const [kind, plain] = rewards(250, false);
  expect(plain["gld-raise"]).toContain(kind);
  expect(plain["gld-rwd"]).toBeUndefined();
  expect(rewards(250)[1]["gld-rwd"]).toEqual(["0", "10", "25", "50", "100", "250"]);
  expect(rewards(60)[1]["gld-rwd"]).toEqual(["0", "10", "25", "50"]);
  expect(rewards(0)[1]["gld-rwd"]).toEqual(["0"]);
  const card = placesCard(o, raisable(60), lex, kind);
  const reward = card.rows.find(
    (r) => "select" in r && decodeId(r.select.customId)?.action === "gld-rwd",
  );
  expect(reward && "select" in reward && decodeId(reward.select.customId)?.target).toBe(kind);
  expect(reward && "select" in reward && reward.select.options[2]?.description).toBe(
    "2 goals: 50 coin from the treasury, and the listing fees",
  );
  // Only an officer standing there picks.
  expect(
    selects(placesCard(o, { ...raisable(60), officer: false }, lex, kind))["gld-rwd"],
  ).toBeUndefined();
});

test("a structure that waits is shown as later and not offered to raise", () => {
  const g: api.Guild = {
    ...guild,
    officer: true,
    settlements: guild.settlements.map((s, i) => ({
      ...s,
      here: i === 0,
      structures: s.structures.map((x, j) =>
        j === 0
          ? { ...x, canRaise: false, waits: "a later milestone" }
          : { ...x, canRaise: true, next: [{ tag: "timber", quantity: 200 }] },
      ),
    })),
  };
  const card = guildCard(o, g, lex, "places");
  const first = g.settlements[0]!.structures[0]!;
  const offered = card.rows.flatMap((r) =>
    "select" in r && decodeId(r.select.customId)?.action === "gld-raise"
      ? r.select.options.map((x) => x.value)
      : [],
  );
  expect(offered.length).toBeGreaterThan(0);
  expect(offered).not.toContain(first.kind);
  expect(card.fields?.find((f) => f.name.startsWith("Later"))?.value).toContain(
    lex.name("settlements.structures", first.kind),
  );
});

test("the works card says what a lit work has spared of what it consumed", () => {
  const works = guild.works.map((x, i) =>
    i === 0 ? { ...x, on: true, spares: true, ran: 9, used: 1260, gave: 310 } : { ...x, on: false },
  );
  const lit = guildCard(o, { ...guild, works }, lex, "works");
  expect(lit.fields?.[0]?.value).toContain("spared 310 coin of the 1,260 coin");
  expect(lit.fields?.[0]?.value).toContain("9 days");
  const dark = guildCard(
    o,
    { ...guild, works: works.map((x) => ({ ...x, on: false })) },
    lex,
    "works",
  );
  expect(dark.fields).toBeUndefined();
});

test("a Stalker with Mark prey is offered the creature tags, and nobody else is", () => {
  const select = (c: api.Classes) =>
    classesCard(o, c).rows.flatMap((r) =>
      "select" in r && decodeId(r.select.customId)?.action === "cls-mark"
        ? [r.select.options.map((x) => x.value)]
        : [],
    );
  expect(select(classes)).toEqual([]);
  expect(select({ ...classes, prey: { tags: ["pack", "wired"], today: "pack" } })).toEqual([
    ["wired"],
  ]);
});

test("the appraisal tells a Master's eye whether the kind is registered, and nobody else", () => {
  const eye = (registered?: boolean) =>
    appraisalCard(o, here, { ...(w.appraise as api.Appraisal), registered }, lex, {
      process: "shape",
    }).fields?.find((f) => f.name === "Master's eye")?.value;
  expect(eye()).toBeUndefined();
  expect(eye(true)).toStartWith("Registered");
  expect(eye(false)).toStartWith("Not registered");
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
  const labels = (c: Card) =>
    c.rows.flatMap((r) => ("buttons" in r ? r.buttons.map((b) => b.label) : []));
  expect(labels(card)).toContain("Carry c-8 home");
  expect(labels(card)).not.toContain("Carry c-7 home");
  // Nobody called: the downed are named, and nobody is offered to carry.
  const quiet = whereCard(o, { ...here, downed: [{ id: "c-7", name: "c-7", called: false }] }, lex);
  expect(labels(quiet).filter((x) => x.startsWith("Carry"))).toEqual([]);
  expect(quiet.fields?.find((f) => f.name === "Down here")?.value).toBe("c-7");
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

test("only an officer is offered to manage a member; anyone may vote on an officer", () => {
  const picks = (g: api.Guild, page = 0) =>
    guildCard(o, g, lex, "members", undefined, page)
      .rows.flatMap((r) => ("select" in r ? r.select.options : []))
      .map((x) => x.value);
  const options = (g: api.Guild, id = "") =>
    (id ? [id] : g.members.map((m) => m.id)).flatMap((m) =>
      memberCard(o, g, m, lex)
        .rows.flatMap((r) => ("buttons" in r ? r.buttons : []))
        .map((b) => (b.kind === "page" ? decodeId(b.customId) : null))
        .filter((x) => x?.action === "gld-act")
        .map((x) => x!.target),
    );
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
      canPromote: false,
      payGoods: false,
      removable: "leader",
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
      canPromote: true,
      payGoods: false,
    },
  ];
  const g = { ...guild, members, treasury: 500, named: 1, officersMax: 2, near: [] };
  expect(picks(g)).toEqual(["c-1", "c-2"]);
  expect(options({ ...g, officer: false })).toEqual(["vote:c-1:leader"]);
  expect(options({ ...g, officer: true })).toEqual([
    "vote:c-1:leader",
    "allow:c-2:1",
    "promote:c-2:-",
  ]);
  // Naming an officer is offered when the world says the viewer may.
  const full = members.map((m) => ({ ...m, canPromote: false }));
  expect(options({ ...g, officer: true, members: full }, "c-2")).toEqual(["allow:c-2:1"]);

  // Every member can be reached, and whoever a vote can stand against is
  // on the first page however little they gave.
  const many: api.GuildMember[] = [
    ...Array.from({ length: 30 }, (_, i) => ({ ...members[1]!, id: `m-${i}`, name: `m-${i}` })),
    members[0]!,
  ];
  const big = { ...g, members: many };
  expect(picks(big)[0]).toBe("c-1");
  expect(picks(big).at(-1)).toBe("page:1");
  expect(picks(big, 1).at(-1)).toBe("page:0");
  expect(new Set([...picks(big), ...picks(big, 1)]).size).toBe(many.length + 2);
});

test("leaving is asked twice, and the last member of a founded guild is told it ends", () => {
  const pressed = (c: Card) =>
    c.rows
      .flatMap((r) => ("buttons" in r ? r.buttons : []))
      .map((b) => (b.kind === "page" ? decodeId(b.customId) : null))
      .map((x) => `${x?.action}:${x?.target}`);
  expect(pressed(guildCard(o, guild, lex))).toContain("gld-leave:");
  const one = leaveCard(o, guild);
  expect(pressed(one)).toEqual(["gld-leave:yes", "guild:members"]);
  expect(one.description).not.toContain("ends when you go");
  const last = leaveCard(o, { ...guild, server: false, members: guild.members.slice(0, 1) });
  expect(pressed(last)).toEqual(["gld-leave:yes", "guild:members"]);
  expect(last.description).toContain("ends when you go");
  // A server's own guild outlives its last member.
  const server = leaveCard(o, { ...guild, server: true, members: guild.members.slice(0, 1) });
  expect(server.description).not.toContain("ends when you go");
});

test("a goal offers a pledge and a withdrawal only when the world does", () => {
  const offered = (x: api.Goal) =>
    goalCard({ ...o, purse: { ...o.purse, coin: 500 } }, goals, x, lex)
      .rows.flatMap((r) => ("buttons" in r ? r.buttons : []))
      .map((b) => (b.kind === "page" ? decodeId(b.customId)?.action : null));
  const open = goalAs({ state: "live", mine: true, claims: 0, canPledge: true, canWithdraw: true });
  expect(offered(open)).toEqual(expect.arrayContaining(["g-pledge", "g-wd"]));
  const taken = offered({ ...open, canPledge: false, canWithdraw: false });
  expect(taken).not.toContain("g-pledge");
  expect(taken).not.toContain("g-wd");
});

test("a worn structure of a starting settlement is mended by the steps the world serves, whatever its tier", () => {
  const repairs = [
    { points: 25, cost: [{ tag: "timber", quantity: 5 }] },
    { points: 60, cost: [{ tag: "timber", quantity: 12 }] },
  ];
  const g: api.Guild = {
    ...guild,
    settlements: guild.settlements.map((s, i) => ({
      ...s,
      here: i === 0,
      structures: s.structures.map((x, j) => ({
        ...x,
        tier: 0,
        stands: j === 0,
        condition: j === 0 ? 40 : 0,
        repairs: j === 0 ? repairs : undefined,
      })),
    })),
  };
  const first = g.settlements[0]!.structures[0]!;
  const card = guildCard(o, g, lex, "places");
  const mend = card.rows.flatMap((r) =>
    "select" in r && decodeId(r.select.customId)?.action === "gld-mend" ? r.select.options : [],
  );
  expect(mend.map((x) => x.value)).toEqual([`${first.kind}:25`, `${first.kind}:60`]);
  expect(mend[0]?.label).toContain("up to 65 pts");
  expect(mend[0]?.description).toBe("Takes 5 goods of timber");
  expect(card.table?.rows.length).toBe(g.settlements.length);
});

test("the character card says which vows are kept and which are broken", () => {
  const vows = [{ title: "No blade this season", broken: true }, { title: "No plate this season" }];
  const field = characterCard(o, here, { ...sheet, vows }, lex).fields?.find(
    (f) => f.name === "Vows",
  );
  expect(field?.value).toContain("No blade this season: broken");
  expect(field?.value).toContain("No plate this season: kept so far");
});
