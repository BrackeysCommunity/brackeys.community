import { expect, test } from "bun:test";

import { memoryStore, Narrator, stubModel } from "../../../packages/mmo-narrate/src/index.ts";
import { heldLines } from "../scripts/narration-held.ts";
import * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { modalFor } from "../src/flow.ts";
import { decodeId, encodeId, type Id } from "../src/ids.ts";
import { capitalise } from "../src/lexicon.ts";
import { HELD_KEY, nameOffers } from "../src/narration/names.ts";
import { bottomCard, entranceCard } from "../src/screens/dungeon.ts";
import { NAME_INPUT, NAME_MOST } from "../src/screens/emergence.ts";
import { recapCard } from "../src/screens/hub.ts";
import { madeCard, recipesCard } from "../src/screens/make.ts";
import {
  DUNGEON_NAME_MOST,
  HELD_NOTICE,
  namingCard,
  nameTarget,
  type NameTarget,
} from "../src/screens/naming.ts";
import * as mm8 from "./fixtures/mm8.ts";
import {
  craft,
  DAY,
  dungeon,
  dungeonHere,
  holdingModel,
  kind,
  kindRefusals,
  lex,
  named,
  names,
  namingWorld,
  narratorOf,
  o,
  promotion,
  recap,
  recipes,
  stubNarrator,
} from "./fixtures/mm11-naming.ts";
import samples from "./fixtures/world.json";

const here = samples.here as api.Here;

const ids = (c: Card) =>
  c.rows.flatMap((r) =>
    "buttons" in r
      ? r.buttons.map((b) => (b.kind === "page" ? decodeId(b.customId) : null))
      : [decodeId(r.select.customId)],
  );
const labels = (c: Card) =>
  c.rows.flatMap((r) => ("buttons" in r ? r.buttons.map((b) => b.label) : []));
const picks = (c: Card) => ids(c).filter((x) => x?.action === "kn-pick" && x.target.includes("/"));

const kindT: NameTarget = { subject: "kind", row: kind.kind };
const promoT: NameTarget = { subject: "promotion", row: promotion.id };
const dungeonT: NameTarget = { subject: "dungeon", row: dungeon };
const open = (t: NameTarget, v = o.version): Id => ({
  action: "kn-name",
  target: nameTarget(t),
  version: v,
});

test("off: the naming card offers keep and your own only, with no description", async () => {
  const { press, writes } = namingWorld();
  const card = (await press(open(kindT))).card;
  expect(labels(card)).toEqual(["Keep the plain name", "Your own…"]);
  expect(card.title).toBe("Name it: Chips tool");
  expect(card.fields).toEqual([]);
  expect(writes).toEqual([]);
  expect(problems(card, names)).toEqual([]);
});

test("good: three suggestions as buttons, and the description in a field", async () => {
  const { narrator, store, model } = stubNarrator("good");
  const { press } = namingWorld({ narrator, store });
  const card = (await press(open(kindT))).card;
  expect(picks(card)).toHaveLength(3);
  expect(labels(card).slice(3)).toEqual(["Keep the plain name", "Your own…"]);
  expect(card.fields?.map((f) => f.name)).toEqual(["What it is"]);
  expect(model.calls.map((c) => c.use)).toEqual(["names"]);
  expect(model.calls[0]!.user).toContain("plain name: Chips tool");
  expect(problems(card, names)).toEqual([]);
  // Asking again is a cache hit: the same card and no new call.
  expect((await press(open(kindT))).card).toEqual(card);
  expect(model.calls).toHaveLength(1);
});

test.each(["number", "name", "mention"] as const)(
  "a %s in the description fails the check, and the card is keep and own only",
  async (mode) => {
    const { narrator, store } = stubNarrator(mode);
    const { press } = namingWorld({ narrator, store });
    const card = (await press(open(kindT))).card;
    expect(labels(card)).toEqual(["Keep the plain name", "Your own…"]);
    expect(card.fields).toEqual([]);
    const ledger = await narrator.ledger(DAY);
    expect(ledger.uses.names?.fallbacks).toEqual({ check: 1 });
  },
);

test("slow: the suggestions miss the press, then appear on the next open", async () => {
  const { narrator, store, model } = stubNarrator("slow", { names: { waitMs: 5 } });
  const { press } = namingWorld({ narrator, store });
  const first = (await press(open(kindT))).card;
  expect(picks(first)).toHaveLength(0);
  await narrator.drain();
  const next = (await press(open(kindT))).card;
  expect(picks(next)).toHaveLength(3);
  expect(model.calls).toHaveLength(1);
});

test("the per-server switch is asked with the press's server, so a DM gets no suggestions", async () => {
  const model = stubModel();
  const store = memoryStore();
  const asked: (string | undefined)[] = [];
  const narrator = new Narrator({
    model,
    store,
    switch: { on: async (_use, server) => (asked.push(server), !!server) },
    dayUsd: 1,
    log: () => {},
  });
  const { press } = namingWorld({ narrator, store, guild: "" });
  expect(picks((await press(open(kindT))).card)).toHaveLength(0);
  expect(model.calls).toHaveLength(0);
  expect(asked).toEqual([""]);
});

test("a suggestion pressed sends kind-name with that name, unscreened", async () => {
  const { narrator, store, model } = stubNarrator("good");
  const { press, writes } = namingWorld({ narrator, store });
  const card = (await press(open(kindT))).card;
  const pick = picks(card)[1]!;
  const name = labels(card)[1]!;
  const done = await press(pick);
  expect(writes).toEqual([
    {
      interactionId: "event",
      characterId: "c-1",
      version: o.version,
      kind: api.ActKindName,
      server: "guild",
      option: kind.kind,
      note: name,
    },
  ]);
  expect(done.card.title).toBe(`Named: ${name}`);
  expect(done.card.author).toBe("Recipes · known kinds");
  expect(model.calls.map((c) => c.use)).toEqual(["names"]);
});

test("a promotion's suggestion sends promote-name, and a dungeon's dungeon-name", async () => {
  const p = stubNarrator("good");
  const pw = namingWorld({ narrator: p.narrator, store: p.store });
  const pc = (await pw.press({ action: "pr-name", target: promotion.id, version: o.version })).card;
  expect(pc.title).toBe(`Name it: ${promotion.name}`);
  expect(pc.author).toBe("Naming · something you were first of");
  await pw.press(picks(pc)[0]!);
  expect(pw.writes.map((w) => [w.kind, w.option, w.note])).toEqual([
    [api.ActPromoteName, promotion.id, labels(pc)[0]],
  ]);
  expect(p.model.calls[0]!.user).toContain("traits: style");

  const d = stubNarrator("good");
  const dw = namingWorld({ narrator: d.narrator, store: d.store, here: dungeonHere });
  const dc = (await dw.press(open(dungeonT, mm8.o.version))).card;
  expect(picks(dc)).toHaveLength(3);
  const done = await dw.press(picks(dc)[2]!);
  expect(dw.writes.map((w) => [w.kind, w.note, w.to])).toEqual([
    [api.ActDungeonName, labels(dc)[2], { q: -28, r: 0 }],
  ]);
  expect(done.card.title).toBe(`Named: ${labels(dc)[2]}`);
});

test("keeping the plain name sends nothing", async () => {
  const { narrator, store } = stubNarrator("good");
  const { press, writes } = namingWorld({ narrator, store });
  const card = (await press(open(kindT))).card;
  const keep = ids(card).find((x) => x?.action === "kn-pick" && !x.target.includes("/"))!;
  const kept = await press(keep);
  expect(writes).toEqual([]);
  expect(kept.card.title).toBe("It keeps its plain name");
});

test("the recap's Name it opens the naming card, not a modal", async () => {
  const card = recapCard(o, here, recap, lex, new Map());
  const pr = ids(card).find((x) => x?.action === "pr-name")!;
  expect(pr).toEqual({ action: "pr-name", target: promotion.id, version: o.version });
  expect(modalFor(pr)).toBeNull();
  const { press, writes } = namingWorld();
  const shown = (await press(pr)).card;
  expect(shown.author).toBe("Naming · something you were first of");
  expect(labels(shown)).toEqual(["Keep the plain name", "Your own…"]);
  expect(writes).toEqual([]);
});

test("Your own… opens its modal from the id alone, and it submits as kn-named", () => {
  for (const [t, most] of [
    [kindT, NAME_MOST],
    [promoT, NAME_MOST],
    [dungeonT, DUNGEON_NAME_MOST],
  ] as const) {
    const own = { action: "kn-own" as const, target: nameTarget(t), version: 41 };
    expect(encodeId(own.action, own.target, own.version).length).toBeLessThanOrEqual(100);
    const modal = modalFor(own)!;
    expect(decodeId(modal.customId)).toEqual({
      action: "kn-named",
      target: nameTarget(t),
      version: 41,
    });
    expect(modal.inputs).toEqual([{ id: NAME_INPUT, label: "Name", max: most, required: true }]);
  }
  expect(modalFor({ action: "kn-own", target: "x:nothing", version: 1 })).toBeNull();
  expect(modalFor({ action: "kn-own", target: "k:", version: 1 })).toBeNull();
  expect(modalFor({ action: "kn-name", target: nameTarget(kindT), version: 1 })).toBeNull();
});

const submit = (t: NameTarget): Id => ({
  action: "kn-named",
  target: nameTarget(t),
  version: 17,
});

test("an own name is screened, then sent when allowed: off, allow, an error and a timeout", async () => {
  const cases = [
    ["off", null],
    ["allow", stubNarrator("good")],
    ["error", stubNarrator("error")],
    ["timeout", stubNarrator("slow", { screen: { waitMs: 5 } })],
  ] as const;
  for (const [what, n] of cases) {
    const { press, writes } = namingWorld({ narrator: n?.narrator, store: n?.store });
    const done = await press(submit(kindT), { [NAME_INPUT]: "  Rust Tooth " });
    expect(
      writes.map((w) => [w.kind, w.option, w.note]),
      what,
    ).toEqual([[api.ActKindName, kind.kind, "Rust Tooth"]]);
    expect(done.card.title, what).toBe("Named: Rust Tooth");
    if (n)
      expect(
        n.model.calls.map((c) => c.use),
        what,
      ).toEqual(["screen"]);
  }
});

test("a held name is not sent: the card says so and the held list keeps it", async () => {
  const model = holdingModel();
  const { narrator, store } = narratorOf(model);
  const { press, writes } = namingWorld({ narrator, store });
  const held = await press(submit(kindT), { [NAME_INPUT]: "Some Name" });
  expect(writes).toEqual([]);
  expect(held.card.title).toBe(HELD_NOTICE);
  expect(problems(held.card, names)).toEqual([]);
  expect(store.list(HELD_KEY).map((e) => JSON.parse(e))).toEqual([
    { use: "kind", user: "someone", target: kind.kind, name: "Some Name", day: DAY },
  ]);
});

test("every own-name submit is screened: promotions, dungeons, guilds and settlements", async () => {
  const cases: [string, Id, Record<string, string>, api.Here | undefined, string][] = [
    [
      "promotion",
      { action: "pr-named", target: promotion.id, version: 17 },
      { [NAME_INPUT]: "Held Edge" },
      undefined,
      promotion.id,
    ],
    [
      "dungeon",
      { action: "d-named", target: dungeon, version: 49 },
      { name: "Held Dark" },
      dungeonHere,
      dungeon,
    ],
    [
      "guild",
      { action: "gld-new", target: "", version: 17 },
      { name: "Held Guild" },
      undefined,
      "",
    ],
    [
      "settlement",
      { action: "gld-chart", target: "", version: 17 },
      { name: "Held Town" },
      undefined,
      "",
    ],
  ];
  for (const [use, id, fields, at, target] of cases) {
    const { narrator, store } = narratorOf(holdingModel());
    const { press, writes } = namingWorld({ narrator, store, here: at });
    const card = (await press(id, fields)).card;
    expect(writes, use).toEqual([]);
    expect(card.title, use).toBe(HELD_NOTICE);
    const [entry] = store.list(HELD_KEY).map((e) => JSON.parse(e));
    expect(entry, use).toEqual({
      use,
      user: "someone",
      target,
      name: Object.values(fields)[0],
      day: DAY,
    });

    const off = namingWorld({ here: at });
    await off.press(id, fields);
    expect(off.writes, `${use} off`).toHaveLength(1);
  }
});

test("the world's refusals re-title the card, and an empty name sends nothing", async () => {
  for (const [code, refusal] of kindRefusals) {
    const { press, writes } = namingWorld({ refusal });
    const card = (await press(submit(kindT), { [NAME_INPUT]: "Rust Tooth" })).card;
    expect(writes, code).toHaveLength(1);
    expect(card.title, code).toBe(capitalise(refusal.message));
    expect(problems(card, names), code).toEqual([]);
  }
  const { press, writes } = namingWorld();
  const blank = await press(submit(kindT), { [NAME_INPUT]: "   " });
  expect(writes).toEqual([]);
  expect(blank.card.title).toBe("Give it a name: a few words the board takes");
  const stale = namingWorld({ refusal: { code: api.CodeStale, message: "stale version" } });
  expect((await stale.press(submit(kindT), { [NAME_INPUT]: "Rust Tooth" })).card.title).toBe(
    "The world moved on: here is the card as it stands.",
  );
});

test("a thing no longer the viewer's to name shows why instead of the card", async () => {
  const { press, writes } = namingWorld({ recipes: named });
  const card = (await press(open(kindT))).card;
  expect(card.title).toBe("It is not yours to name now");
  expect(card.author).toBe("Recipes · known kinds");
  expect(writes).toEqual([]);
  const gone = namingWorld();
  expect((await gone.press(open({ subject: "promotion", row: "road:1" }))).card.title).toBe(
    "It is not yours to name now",
  );
});

test("a malformed naming id is unknown, never a write", async () => {
  const { press, writes } = namingWorld();
  for (const target of ["", "q:x", "k:", "k:a/"]) {
    for (const action of ["kn-name", "kn-pick", "kn-named"] as const) {
      const card = (await press({ action, target, version: 1 }, { [NAME_INPUT]: "Rust Tooth" }))
        .card;
      expect(card.title, `${action} ${target}`).not.toStartWith("Named");
    }
  }
  expect(writes).toEqual([]);
});

test("the discovery card's Name it opens the naming card, with the description once drawn", async () => {
  const plain = madeCard(o, here, craft.facts, lex);
  const nameIt = ids(plain).find((x) => x?.action === "kn-name")!;
  expect(nameIt).toEqual({ action: "kn-name", target: nameTarget(kindT), version: o.version });
  expect(plain.fields?.some((f) => f.name === "What it is")).toBe(false);
  expect(problems(plain, names)).toEqual([]);
  const failed = madeCard(
    o,
    here,
    [...craft.facts, { ...craft.facts[0]!, kind: "craft.failed" }],
    lex,
  );
  expect(ids(failed).some((x) => x?.action === "kn-name")).toBe(false);

  const { narrator, store, model } = stubNarrator("good");
  const { press } = namingWorld({ narrator, store });
  const made = (
    await press({ action: "craft-go", target: "shape.narrow-grind.tool.chips.1", version: 1 })
  ).card;
  expect(made.fields?.find((f) => f.name === "What it is")?.value).toBeTruthy();
  expect(problems(made, names)).toEqual([]);
  // The naming card then finds the names ready.
  expect(picks((await press(nameIt)).card)).toHaveLength(3);
  expect(model.calls.map((c) => c.use)).toEqual(["names"]);
});

test("recipes carry Name it while a kind is renamable, and its description once cached", async () => {
  const bare = recipesCard(o, here, recipes, lex);
  expect(ids(bare).filter((x) => x?.action === "kn-name")).toEqual([
    { action: "kn-name", target: nameTarget(kindT), version: o.version },
  ]);
  expect(labels(bare)[0]).toBe("Name it: Chips tool");
  expect(problems(bare, names)).toEqual([]);
  expect(ids(recipesCard(o, here, named, lex)).some((x) => x?.action === "kn-name")).toBe(false);

  const { narrator, store, model } = stubNarrator("good");
  const { press } = namingWorld({ narrator, store });
  const before = (await press({ action: "recipes", target: "", version: 1 })).card;
  expect(before.fields).toEqual([]);
  expect(model.calls).toHaveLength(0);
  await press(open(kindT));
  const after = (await press({ action: "recipes", target: "", version: 1 })).card;
  expect(after.fields?.map((f) => f.name)).toEqual(["Chips tool"]);
  expect(problems(after, names)).toEqual([]);
  expect(model.calls).toHaveLength(1);
});

test("the dungeon's cards offer its own name and the naming card", () => {
  const entrance = entranceCard(mm8.o, dungeonHere, lex, "c-1");
  expect(ids(entrance).filter((x) => x?.action === "d-name" || x?.action === "kn-name")).toEqual([
    { action: "d-name", target: dungeon, version: mm8.o.version },
    { action: "kn-name", target: nameTarget(dungeonT), version: mm8.o.version },
  ]);
  expect(problems(entrance, names)).toEqual([]);
  const bottom = bottomCard(mm8.o, dungeonHere, lex, dungeonHere.recent, "c-1");
  expect(ids(bottom).some((x) => x?.action === "kn-name")).toBe(true);
  expect(problems(bottom, names)).toEqual([]);
});

test("every naming card passes problems()", () => {
  const offer = {
    names: ["Rust Tooth", "Ash Edge", "O'Malley's Pick"],
    description: "A narrow tool ground from chips, the first of its kind.",
  };
  const long = { names: ["A".repeat(40), "B".repeat(40), "C".repeat(40)] };
  for (const t of [kindT, promoT, dungeonT]) {
    for (const [what, card] of [
      ["off", namingCard(7, t, "Chips tool", null)],
      ["offer", namingCard(7, t, "Chips tool", offer)],
      ["long names", namingCard(123456, t, "the flooded stair", long)],
      ["held", namingCard(7, t, "Chips tool", offer, HELD_NOTICE)],
    ] as const) {
      expect(problems(card, names), `${t.subject} ${what}`).toEqual([]);
    }
  }
});

test("nameOffers: no narrator suggests nothing and allows every name", async () => {
  const off = nameOffers(null);
  const ctx = { day: 1, server: "g", user: "u" };
  expect(await off.suggest("kind", "k", "Chips tool", { traits: [], lineage: [] }, ctx)).toBeNull();
  expect(await off.screen("anything", { ...ctx, use: "guild", target: "" })).toBe("allow");
  // A held name with no store to record it in is still held.
  const { narrator } = narratorOf(holdingModel());
  const lines: string[] = [];
  const noStore = nameOffers(narrator, null, (l) => lines.push(l));
  expect(await noStore.screen("Some Name", { ...ctx, use: "guild", target: "" })).toBe("hold");
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("Some Name");
  // A refused screen allows.
  const refusing = narratorOf(stubModel({ mode: "refusal" }));
  expect(
    await nameOffers(refusing.narrator, refusing.store).screen("Some Name", {
      ...ctx,
      use: "guild",
      target: "",
    }),
  ).toBe("allow");
});

test("a held name resubmitted by the same player is recorded once", async () => {
  const { narrator, store } = narratorOf(holdingModel());
  const offers = nameOffers(narrator, store);
  const ctx = { day: DAY, server: "g", use: "kind" as const, target: kind.kind };
  expect(await offers.screen("Some Name", { ...ctx, user: "u1" })).toBe("hold");
  expect(await offers.screen("some  name", { ...ctx, user: "u1" })).toBe("hold");
  expect(store.list(HELD_KEY)).toHaveLength(1);
  expect(await offers.screen("Some Name", { ...ctx, user: "u2" })).toBe("hold");
  expect(store.list(HELD_KEY).map((e) => JSON.parse(e).user)).toEqual(["u2", "u1"]);
});

test("two screens of one held name at once are recorded once", async () => {
  const { narrator, store } = narratorOf(holdingModel());
  const offers = nameOffers(narrator, store);
  const ctx = { day: DAY, server: "g", use: "kind" as const, target: kind.kind, user: "u1" };
  expect(
    await Promise.all([offers.screen("Some Name", ctx), offers.screen("Some Name", ctx)]),
  ).toEqual(["hold", "hold"]);
  expect(store.list(HELD_KEY)).toHaveLength(1);
});

test("the held list reads as lines, newest first, and tolerates a bad entry", () => {
  expect(heldLines([])).toEqual(["no names are held"]);
  const entry = JSON.stringify({
    use: "kind",
    user: "u-1",
    target: "k1",
    name: "Some Name",
    day: 4,
  });
  expect(heldLines([entry, "{not json"])).toEqual([
    "2 held (the last 500 are kept), newest first:",
    'day 4 · kind k1 · user u-1 · "Some Name"',
    "(unreadable entry) {not json",
  ]);
});
