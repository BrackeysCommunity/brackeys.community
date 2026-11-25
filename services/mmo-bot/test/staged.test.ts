import { describe, expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { decodeId } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { factLine, goodsLine, held, stagedHeld, usable } from "../src/screens/common.ts";
import { huntCard, huntClosedCard, huntPostCard } from "../src/screens/hunt.ts";
import { characterCard, craftCard, itemCard } from "../src/screens/make.ts";
import {
  bookCard,
  draftId,
  draftOf,
  gearCard,
  isList,
  orderForm,
  ordersCard,
  stagedBookCard,
} from "../src/screens/market.ts";
import {
  contestsOf,
  crateOpen,
  dropCard,
  fairCard,
  placedOf,
  stagedOf,
} from "../src/screens/staged.ts";
import { eventCard } from "../src/screens/story.ts";
import type { HuntPost } from "../src/world.ts";
import * as mm10 from "./fixtures/mm10.ts";
import * as mm11a from "./fixtures/mm11a.ts";
import samples from "./fixtures/world.json";

/** The staged cards and marks (GDD 10.8, 14.4, 14.5): each keeps the card standard, and staged goods say where they stay. */

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
  bandEdges: { notorious: -50, crooked: -10, decent: 10, upright: 50 },
  goodDay: 6,
  pairDay: 2,
  hotDays: 7,
  hotReach: 12,
  wantedDays: 3,
  fencePays: 60,
  backRoomPays: 70,
  gate: 25,
  trusted: 50,
  grudgeDays: 60,
  launderPercent: 10,
};
const lex = new Lexicon(
  mm11a.lexicon(
    mm10.lexicon({
      ...(w.lexicon as Omit<api.Lexicon, "numbers">),
      numbers: NUMBERS,
      starts: ["hook", "knife", "deck"],
    }),
  ),
);
const names = lex.goodsNames();
const base = w.options as api.Options;
const here = w.here as api.Here;
const sheet = w.sheet as api.Sheet;
const recipes = w.recipes as api.Recipes;
const market = w.market as api.Market;
const recordedBoard = w.board as api.Board;

/** Pylon Camp is settlement 0 in the recording: goods staged there trade on its staged book. */
const HERE: api.StagedAt = { settlement: market.settlement, name: market.name };
const AWAY: api.StagedAt = { settlement: 4, name: "Old Rail" };

const staffBy: api.Placed = { by: "staff", label: "Brackeys", points: 60 };
const adminsBy: api.Placed = { by: "admins", label: "Brackeys" };

function clean(card: Card): string[] {
  return problems(card, names);
}

/** The ids of a card's buttons and selects, decoded to their actions. */
function actions(card: Card): string[] {
  return card.rows.flatMap((r) =>
    "buttons" in r
      ? r.buttons.flatMap((b) => (b.kind === "page" ? [decodeId(b.customId)?.action ?? ""] : []))
      : [decodeId(r.select.customId)?.action ?? ""],
  );
}

function buttonLabels(card: Card): string[] {
  return card.rows.flatMap((r) => ("buttons" in r ? r.buttons.map((b) => b.label) : []));
}

/** Every text of a card, to look for a line in. */
function text(card: Card): string {
  return [
    card.title,
    card.description ?? "",
    ...(card.fields ?? []).map((f) => `${f.name}: ${f.value}`),
    ...(card.table?.rows.flat() ?? []),
    ...card.rows.flatMap((r) =>
      "select" in r ? r.select.options.flatMap((o) => [o.label, o.description ?? ""]) : [],
    ),
  ].join("\n");
}

const drop: api.StageView = {
  id: "st-3",
  template: "drop-large",
  kind: "drop",
  placed: adminsBy,
  settlement: HERE.settlement,
  place: HERE.name,
  at: { q: base.at.q + 2, r: base.at.r },
  opens: 10,
  ends: 586,
  open: true,
  crates: 118,
};
const fair: api.StageView = {
  ...drop,
  id: "st-4",
  template: "fair",
  kind: "fair",
  placed: staffBy,
  crates: 40,
  goals: ["g-rat", "g-blade"],
};

function contest(id: string, title: string, what: string, claims: number): api.Goal {
  return {
    ...recordedBoard.posts[0]!.goal,
    id,
    title,
    what,
    issuer: "staged",
    by: "st-4",
    mode: "each",
    cap: 10,
    claims,
    reward: 0,
    vow: false,
  };
}
const board: api.Board = {
  ...recordedBoard,
  posts: [
    ...recordedBoard.posts,
    {
      ...recordedBoard.posts[0]!,
      goal: contest("g-rat", "Rat cull", "defeat 5 creatures, a reed rat", 2),
    },
    {
      ...recordedBoard.posts[0]!,
      goal: contest("g-blade", "Blade smith", "make 1 item, a blade", 0),
    },
  ],
};

const onTile: api.Options = { ...base, at: drop.at };

function datum(k: string, v: string | number): api.Datum {
  return typeof v === "number" ? { k, n: v } : { k, s: v };
}

function stagedFact(
  id: number,
  kind: string,
  stage: string,
  data: Record<string, string | number>,
): api.Fact {
  return {
    id,
    tick: 40,
    kind,
    subjects: [{ kind: "stage", id: stage }],
    data: Object.entries(data).map(([k, v]) => datum(k, v)),
    weight: 50,
  };
}

const opened = (kind: string, template: string, role: string, extra = {}): api.StoryEvent => ({
  fact: stagedFact(21, "staged.opened", "st-3", {
    template,
    kind,
    settlement: HERE.settlement,
    role,
    label: "Brackeys",
    points: role === "staff" ? 60 : 0,
    days: 2,
    crates: kind === "drop" || kind === "fair" ? 120 : 0,
    ...extra,
  }),
  place: HERE.name,
  server: "guild-a",
});

const crateFact = stagedFact(30, "crate.opened", "st-3", {
  stage: "st-3",
  material: "chips",
  units: 3,
  crate: 2,
  left: 117,
});

describe("the drop and fair cards", () => {
  test("a drop's post names who staged it and offers Open a crate, which the world refuses off the tile", () => {
    const card = dropCard(drop);
    expect(clean(card)).toEqual([]);
    expect(card.description).toContain("Staged by the admins of Brackeys");
    expect(text(card)).toContain("118 crates left");
    expect(actions(card)).toEqual(["crate"]);
    expect(card.context).toContain("Events channel");
  });

  test("a drop as a character sees it: Open a crate on the tile, Go there off it", () => {
    const on = dropCard(drop, onTile);
    expect(clean(on)).toEqual([]);
    expect(actions(on)).toEqual(["crate", "hub"]);
    const off = dropCard(drop, base);
    expect(clean(off)).toEqual([]);
    expect(actions(off)).toEqual(["goto", "hub"]);
    expect(text(off)).toContain("2 tiles away");
  });

  test("a closed drop offers no crate", () => {
    const card = dropCard({ ...drop, open: false, closed: true, crates: 0 });
    expect(clean(card)).toEqual([]);
    expect(actions(card)).toEqual([]);
    expect(card.title).toContain("is over");
  });

  test("a fair lists its contests with their winners, the prize, the drop and its banner", () => {
    const contests = contestsOf(board, fair);
    expect(contests.map((g) => g.id)).toEqual(["g-rat", "g-blade"]);
    const art: api.Art = { slot: "fair", key: "art-fair" };
    const card = fairCard(fair, contests, undefined, art);
    expect(clean(card)).toEqual([]);
    expect(card.description).toContain("Staged by staff of Brackeys · 60 event points");
    expect(text(card)).toContain("Rat cull: defeat 5 creatures, a reed rat, 2 of 10 claims");
    expect(text(card)).toContain("staged · local to Pylon Camp; never coin");
    expect(text(card)).toContain("40 crates left");
    expect(card.picture).not.toBe("form");
    expect(actions(card)).toEqual(["crate"]);
    const mine = fairCard(fair, contests, base, art);
    expect(clean(mine)).toEqual([]);
    expect(actions(mine)).toEqual(["goto", "goals", "hub"]);
  });

  test("a fair whose contests were not read points at the board", () => {
    const card = fairCard(fair, []);
    expect(clean(card)).toEqual([]);
    expect(text(card)).toContain("On the notice board at Pylon Camp");
  });
});

describe("opening a crate", () => {
  test("a crate opened shows what it held, staged, and Open another on the tile", () => {
    const card = crateOpen(onTile, drop, lex, [crateFact]);
    expect(clean(card)).toEqual([]);
    expect(card.title).toBe("You opened a crate");
    expect(card.description).toContain("staged · local to Pylon Camp");
    expect(text(card)).toContain("117 crates left");
    expect(buttonLabels(card)).toEqual(["Open another", "Hub"]);
  });

  test("refused off the tile, it says so and offers Go there", () => {
    const card = crateOpen(base, drop, lex, [], "The crates of st-3 are on another tile");
    expect(clean(card)).toEqual([]);
    expect(card.title).toBe("The crates of st-3 are on another tile");
    expect(card.description).toContain("2 tiles away");
    expect(actions(card)).toEqual(["goto", "hub"]);
  });

  test("a drop that is gone reads as over, and one with no crates left offers none", () => {
    const gone = crateOpen(base, undefined, lex, [], "No crates left");
    expect(clean(gone)).toEqual([]);
    expect(actions(gone)).toEqual(["hub"]);
    const empty = crateOpen(onTile, { ...drop, crates: 1 }, lex, [
      { ...crateFact, data: crateFact.data.map((d) => (d.k === "left" ? { k: "left", n: 0 } : d)) },
    ]);
    expect(clean(empty)).toEqual([]);
    expect(actions(empty)).toEqual(["hub"]);
  });

  test("a crate opened is a templated line in the hub", () => {
    expect(factLine(crateFact, lex)).toBe(
      `Opened a staged crate: ${goodsLine([{ material: "chips", units: 3 }], lex)}, which stay where they were staged; 117 crates left.`,
    );
  });
});

describe("staged events in the events channel", () => {
  test("a staging's opening, close and a vault taken each have a card that names no character", () => {
    const evs: api.StoryEvent[] = [
      opened("drop", "drop-large", "admin"),
      opened("fair", "fair", "staff"),
      opened("hunt", "hunt-2", "staff"),
      opened("contest", "contest", "staff"),
      opened("hardship", "storm", "staff"),
      {
        fact: stagedFact(22, "staged.closed", "st-3", {
          template: "drop-large",
          kind: "drop",
          settlement: 0,
          role: "admin",
          label: "Brackeys",
          days: 2,
          crates: 37,
          winners: 0,
          why: "",
        }),
        place: HERE.name,
        server: "guild-a",
      },
      {
        fact: stagedFact(23, "vault.taken", "st-9", {
          stage: "st-9",
          template: "vault",
          label: "Brackeys",
          settlement: 0,
          family: "circuit",
          level: 2,
          seats: 3,
          goods: 9,
        }),
        place: HERE.name,
        server: "guild-a",
      },
    ];
    for (const ev of evs) {
      const card = eventCard(ev, lex);
      expect(card).not.toBeNull();
      expect(clean(card!)).toEqual([]);
    }
    expect(eventCard(evs[0]!, lex)!.title).toBe("A drop of crates near Pylon Camp");
    expect(eventCard(evs[2]!, lex)!.description).toContain(
      "Staged by staff of Brackeys · 60 event points",
    );
  });

  test("a drop's opening read with the house's stage carries the tile and the crates left", () => {
    const ev = { ...opened("drop", "drop-large", "admin"), stage: { ...drop, crates: 90 } };
    const card = eventCard(ev, lex)!;
    expect(text(card)).toContain("90 crates left");
    const fromFact = stagedOf(opened("drop", "drop-large", "admin"));
    expect(fromFact.id).toBe("st-3");
    expect(fromFact.placed).toEqual(adminsBy);
    expect(fromFact.crates).toBe(120);
    expect(placedOf("staff", "Brackeys", 60)).toEqual(staffBy);
  });
});

describe("staged marks on goods and items", () => {
  const goods: api.Goods[] = [
    { material: "chips", units: 3 },
    { material: "chips", units: 5, staged: HERE },
    { material: "chips", units: 2, staged: AWAY },
  ];
  const carrying: api.Options = { ...base, purse: { ...base.purse, goods } };

  test("a staged good shows staged · local to its settlement", () => {
    const line = goodsLine(goods, lex);
    expect(line).toContain("(staged · local to Pylon Camp)");
    expect(line).toContain("(staged · local to Old Rail)");
  });

  test("held is clean only, staged units are counted by origin, and a craft takes one origin", () => {
    expect(held(goods, "chips")).toBe(3);
    expect(stagedHeld(goods, "chips", HERE.settlement)).toBe(5);
    expect(stagedHeld(goods, "chips", AWAY.settlement)).toBe(2);
    expect(usable(goods, "chips")).toBe(8);
  });

  test("the craft card offers each material once, saying where its staged units are from", () => {
    const withGoods = { ...sheet, character: { ...sheet.character, goods } };
    const card = craftCard(base, here, withGoods, recipes, lex, {
      process: "alloy",
      method: "quench",
    });
    expect(clean(card)).toEqual([]);
    const select = card.rows.flatMap((r) => ("select" in r ? [r.select] : []))[0]!;
    expect(select.options.map((o) => o.value)).toEqual(["chips"]);
    expect(select.options[0]!.label).toBe(goodsLine([{ material: "chips", units: 8 }], lex));
    expect(select.options[0]!.description).toContain("5 goods staged · local to Pylon Camp");
    const qty = craftCard(base, here, withGoods, recipes, lex, {
      process: "alloy",
      method: "quench",
      material: "chips",
    });
    expect(clean(qty)).toEqual([]);
    expect(actions(qty).filter((x) => x === "craft-q")).toHaveLength(3);
  });

  test("faction orders never offer staged goods, and the book shows the staged book beside it", () => {
    const orders = ordersCard(carrying, market, lex);
    expect(clean(orders)).toEqual([]);
    expect(buttonLabels(orders).filter((l) => l.startsWith("Sell")).length).toBeLessThanOrEqual(1);
    const book = bookCard(carrying, market, lex);
    expect(clean(book)).toEqual([]);
    expect(text(book)).toContain("Staged book: no orders yet; you hold");
    expect(text(book)).toContain("staged · local to Pylon Camp");
    // The plain book counts only clean units.
    expect(text(book)).toContain("You hold: 3");
  });

  test("the staged book's card: its own levels, no fee, and what is staged elsewhere", () => {
    const m: api.Market = {
      ...market,
      stagedBook: {
        material: "chips",
        bids: [{ price: 18, units: 2, who: "Ada" }],
        asks: [{ price: 21, units: 4, who: "Bram" }],
        last: 20,
        value: 23,
      },
    };
    const card = stagedBookCard(carrying, m, lex);
    expect(clean(card)).toEqual([]);
    expect(card.description).toContain("no fee");
    expect(text(card)).toContain("You hold, staged here: 5");
    expect(text(card)).toContain("staged · local to Old Rail: trade it there");
    expect(card.table?.rows).toEqual([
      ["ask", "21 coin", "4 goods", "Bram"],
      ["bid", "18 coin", "2 goods", "Ada"],
    ]);
    const post = card.rows
      .flatMap((r) => ("buttons" in r ? r.buttons : []))
      .find((b) => b.label === "Post an order")!;
    const id = decodeId(post.kind === "page" ? post.customId : "")!;
    expect(draftOf(id.target)).toEqual({
      material: "chips",
      side: "ask",
      price: 23,
      units: 1,
      staged: true,
    });
    // Only a market with staged goods or a staged book lists it.
    expect(isList("staged")).toBe(true);
    const plain = bookCard(base, market, lex);
    expect(text(plain)).not.toContain("Staged book");
  });

  test("a staged draft round-trips, a plain one keeps its four fields, and the form says no fee", () => {
    const d = { material: "chips", side: "ask" as const, price: 21, units: 2, staged: true };
    expect(draftId(d)).toBe("chips.ask.21.2.s");
    expect(draftOf(draftId(d))).toEqual(d);
    expect(draftId({ ...d, staged: false })).toBe("chips.ask.21.2");
    expect(draftOf("chips.ask.21.2")).toEqual({
      material: "chips",
      side: "ask",
      price: 21,
      units: 2,
    });
    expect(draftOf("chips.ask.21.2.x")).toBeNull();
    const form = orderForm(carrying, market, d, lex);
    expect(clean(form)).toEqual([]);
    expect(form.title).toContain("staged here");
    expect(form.description).toContain("no fee");
  });

  test("a staged item says where it stays, and no trader is offered it", () => {
    const blade = sheet.kit[0]!;
    const staged: api.Item = { ...blade, id: "it-7", worn: undefined, staged: HERE };
    const card = itemCard({ ...base, purse: { ...base.purse, market: true } }, here, staged, lex);
    expect(clean(card)).toEqual([]);
    expect(text(card)).toContain("staged · local to Pylon Camp");
    expect(actions(card)).not.toContain("sell-item");
    expect(actions(itemCard(base, here, { ...blade, worn: undefined }, lex))).toContain(
      "sell-item",
    );
    const ch = characterCard(base, here, { ...sheet, pack: [staged] }, lex);
    expect(clean(ch)).toEqual([]);
    expect(text(ch)).toContain("staged · local to Pylon Camp");
  });

  test("a staged listing is marked on the gear card", () => {
    const listing: api.Listing = {
      id: "l-1",
      kind: "k",
      name: "Scrap iron blade",
      slot: "blade",
      level: 2,
      picks: 0,
      durability: 30,
      max: 60,
      maker: "c-3",
      seller: "c-3",
      price: 40,
      value: 30,
      mine: false,
      sigil: "",
      staged: true,
    };
    const card = gearCard(base, { ...market, gear: [listing] }, lex);
    expect(clean(card)).toEqual([]);
    expect(text(card)).toContain("(staged)");
    expect(text(card)).toContain("sold only here, to players");
  });
});

describe("the label on staged hunts", () => {
  const hunt: HuntPost = {
    id: "h-9",
    row: "cinder-hound",
    name: "The cinder hound",
    creature: "cinder-hound",
    at: base.at,
    region: "region:0",
    health: 40,
    max: 60,
    ends: 300,
    pressers: [{ name: "c-2", removed: 20 }],
    spoils: [{ material: "chips", units: 4 }],
    placed: staffBy,
    stage: "st-5",
  };

  test("a staged hunt says who staged it on every card", () => {
    for (const card of [
      huntPostCard(hunt, lex),
      huntClosedCard({ ...hunt, closed: true, slain: true, rolled: [], shares: [] }, lex),
      huntCard(base, here, hunt, undefined, lex),
    ]) {
      expect(clean(card)).toEqual([]);
      expect(card.author).toStartWith("Staged hunt");
      expect(card.description).toContain("Staged by staff of Brackeys · 60 event points");
    }
    const world = huntPostCard({ ...hunt, placed: undefined, stage: undefined }, lex);
    expect(world.author).toStartWith("Hunt");
    expect(world.description).not.toContain("Staged");
  });
});
