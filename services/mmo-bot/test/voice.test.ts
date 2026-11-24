import { expect, test } from "bun:test";

import {
  fixedSwitch,
  memoryStore,
  type ModelCall,
  type NarrationModel,
  Narrator,
  type Switch,
  USE_CONFIG,
} from "../../../packages/mmo-narrate/src/index.ts";
import { memoryLines } from "../../../packages/mmo-words/src/memory.ts";
import * as api from "../src/api.ts";
import { type Card, problems } from "../src/card.ts";
import { answer, type Ctx } from "../src/flow.ts";
import { decodeId } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { createNarration, dayClock } from "../src/narration/hooks.ts";
import { lastKey, summaryDayKey, summaryKey, voiceNarration } from "../src/narration/voice.ts";
import { talkCard } from "../src/screens/talk.ts";
import type { World } from "../src/world.ts";
import * as mm8 from "./fixtures/mm8.ts";
import { conversation, dossier, lastLine, longerRoad, plain } from "./fixtures/mm11-voice.ts";
import samples from "./fixtures/world.json";

const lex = new Lexicon({
  ...(samples.lexicon as unknown as api.Lexicon),
  starts: ["hook", "knife", "deck"],
  numbers: {
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
  },
});
const names = lex.goodsNames();
const o = mm8.o;
const USER = "u-1";
const SERVER = "g-1";

type Reply = {
  topics: { id: string; line: string; choices: { id: string; line: string }[] }[];
  last: string;
};

/**
 * A model that answers the voice with what `voice` makes of the use's own
 * stub reply, and every other use with its stub. It never touches the
 * network.
 */
function model(voice: (stub: Reply, call: ModelCall) => unknown = (s) => s) {
  const calls: ModelCall[] = [];
  const m: NarrationModel & { calls: ModelCall[] } = {
    calls,
    async complete(call) {
      calls.push(call);
      const reply =
        call.use === "voice" ? voice(structuredClone(call.stub) as Reply, call) : call.stub;
      const text = JSON.stringify(reply);
      return {
        text,
        stop: "end",
        usage: {
          input: Math.ceil((call.system + call.user).length / 4),
          output: Math.ceil(text.length / 4) + USE_CONFIG[call.use].stubThinking,
          cacheRead: 0,
          cacheWrite: 0,
        },
      };
    },
  };
  return m;
}

/** The tinker in its own words: the number line first, the gossip second, the rumour left out. */
const told = (s: Reply): Reply => {
  const road = s.topics.find((t) => t.id === longerRoad.id)!;
  const gossip = s.topics.find((t) => t.id === "gossip")!;
  road.line = "Ada Mercer squints at the road: it takes 12 tiles longer than it used to.";
  road.choices = [
    { id: "shrug", line: "You shrug it off." },
    { id: "clear-path", line: "You promise to clear the way." },
  ];
  gossip.line = "Ada Mercer leans in: talk at Pylon Camp says Mags Rask speaks well of you.";
  gossip.choices = gossip.choices.map((c) => ({
    ...c,
    line: `${c.line.replace(/\.$/, "")}, quietly.`,
  }));
  return { topics: [road, gossip], last: "Ada Mercer had said, warily, that you were a stranger." };
};

function setup(opts: { voice?: (s: Reply, c: ModelCall) => unknown; sw?: Switch } = {}) {
  const store = memoryStore();
  const m = model(opts.voice ?? told);
  const sw = opts.sw ?? fixedSwitch(true);
  const narrator = new Narrator({ model: m, store, switch: sw, dayUsd: 1, log: () => {} });
  const voice = voiceNarration(narrator, store, lex, sw);
  return { store, m, narrator, voice };
}

const cardOf = (r: { conv: api.Conversation; remembers?: string }) =>
  talkCard(o, r.conv, undefined, undefined, r.remembers);

const buttonsOf = (c: Card) =>
  c.rows.flatMap((r) => ("buttons" in r ? r.buttons : [])).filter((b) => b.kind === "page");

test("off: no dossier is asked for, and the world's conversation is shown unchanged", async () => {
  const { voice, m } = setup({ sw: fixedSwitch(false) });
  expect(await voice.wantsDossier(USER, SERVER)).toBe(false);
  const bare = plain(conversation());
  const r = await voice.talk(bare, USER, SERVER);
  expect(r.conv).toBe(bare);
  expect(r.remembers).toBeUndefined();
  // With the dossier read but the voice off, the conversation is still the world's.
  const c = conversation({ folded: false });
  expect((await voice.talk(c, USER, SERVER)).conv).toEqual(c);
  expect(m.calls).toHaveLength(0);
});

test("a DM is always off, and a server is on only when its switch is", async () => {
  const levels: Record<string, string> = { "server:g-1": "on" };
  const store = memoryStore();
  const redisLike = {
    ...store,
    hgetall: async (k: string) => (k.endsWith("switch") ? levels : {}),
  };
  const narrator = new Narrator({
    model: model(),
    store,
    switch: fixedSwitch(true),
    dayUsd: 1,
    log: () => {},
  });
  const voice = voiceNarration(narrator, redisLike, lex);
  expect(await voice.wantsDossier(USER, "g-1")).toBe(true);
  expect(await voice.wantsDossier(USER, "g-2")).toBe(false);
  expect(await voice.wantsDossier(USER, "")).toBe(false);
});

test("good: the picked topics in the model's order, voiced, under the same ids", async () => {
  const { voice, m, narrator } = setup();
  expect(await voice.wantsDossier(USER, SERVER)).toBe(true);
  const c = conversation({ folded: false });
  const r = await voice.talk(c, USER, SERVER);
  expect(m.calls.map((x) => x.use)).toEqual(["voice"]);
  expect(r.conv.topics.map((t) => t.id)).toEqual([longerRoad.id, "gossip"]);
  expect(r.conv.topics[0]!.line).toBe(
    "Ada Mercer squints at the road: it takes 12 tiles longer than it used to.",
  );
  // Choices keep the world's order, effects and ids; only their words change.
  expect(r.conv.topics[0]!.choices).toEqual([
    { ...longerRoad.choices[0]!, line: "You promise to clear the way." },
    { ...longerRoad.choices[1]!, line: "You shrug it off." },
  ]);
  expect(r.remembers).toBeUndefined();

  const card = cardOf(r);
  const template = talkCard(o, c);
  expect(card.description).toContain("• Ada Mercer squints at the road");
  expect(card.description).not.toContain("strange shape");
  const ids = (x: Card) => buttonsOf(x).map((b) => b.customId);
  const shown = new Set(ids(template));
  for (const id of ids(card)) expect(shown.has(id)).toBe(true);
  for (const b of buttonsOf(card)) {
    const d = decodeId(b.customId);
    if (d?.action !== "choose") continue;
    const [, topic, choice] = d.target.split("/");
    expect(c.topics.find((t) => t.id === topic)?.choices.some((x) => x.id === choice)).toBe(true);
  }
  expect(buttonsOf(card).map((b) => b.label)).toContain("You ask what else is said, quietly");
  expect(problems(card, names)).toEqual([]);
  const ledger = await narrator.ledger(dossier.day);
  expect(ledger.uses.voice?.calls).toBe(1);
});

test("a bad id, a dropped choice or a number not in its line gives the world's conversation", async () => {
  const cases: [string, (s: Reply) => Reply][] = [
    ["bad-id", (s) => ({ ...s, topics: s.topics.map((t, i) => (i ? t : { ...t, id: "debt" })) })],
    [
      "dropped choice",
      (s) => ({
        ...s,
        topics: s.topics.map((t, i) => (i ? t : { ...t, choices: t.choices.slice(1) })),
      }),
    ],
    [
      "number",
      (s) => ({
        ...s,
        topics: s.topics.map((t) =>
          t.id === longerRoad.id ? { ...t, line: "Ada Mercer's road takes 14 tiles longer." } : t,
        ),
      }),
    ],
  ];
  for (const [name, bad] of cases) {
    const { voice, m, narrator } = setup({ voice: bad });
    const c = conversation({ folded: false });
    const r = await voice.talk(c, USER, SERVER);
    expect(r.conv, name).toEqual(c);
    expect(cardOf(r), name).toEqual(talkCard(o, c));
    expect(m.calls, name).toHaveLength(1);
    const fb = (await narrator.ledger(dossier.day)).uses.voice?.fallbacks;
    expect(fb, name).toEqual({ check: 1 });
    // The same conversation asked again is not paid for again.
    expect((await voice.talk(c, USER, SERVER)).conv, name).toEqual(c);
    expect(m.calls, name).toHaveLength(1);
  }
});

test("the sixth model call of a player's world day falls back as cap", async () => {
  const { voice, m, narrator } = setup();
  const cap = USE_CONFIG.voice.perDayCap!;
  for (let i = 0; i <= cap; i++) {
    const c = conversation({ folded: false, digest: `talk-${i}` });
    const r = await voice.talk(c, USER, SERVER);
    if (i < cap) expect(r.conv.topics[0]!.id, `call ${i + 1}`).toBe(longerRoad.id);
    else expect(r.conv, "the sixth").toEqual(c);
  }
  expect(m.calls).toHaveLength(cap);
  const l = await narrator.ledger(dossier.day);
  expect(l.uses.voice?.calls).toBe(cap);
  expect(l.uses.voice?.fallbacks).toEqual({ cap: 1 });
  // Another player, or the next day, has a fresh allowance.
  await voice.talk(conversation({ folded: false, digest: "other" }), "u-2", SERVER);
  await voice.talk(conversation({ folded: false, day: dossier.day + 1 }), USER, SERVER);
  expect(m.calls).toHaveLength(cap + 2);
});

test("asking again the same day gives an identical card from the cache", async () => {
  const { voice, m, narrator } = setup();
  const first = cardOf(await voice.talk(conversation(), USER, SERVER));
  await voice.idle();
  const second = cardOf(await voice.talk(conversation(), USER, SERVER));
  const third = cardOf(await voice.talk(conversation(), USER, SERVER));
  expect(m.calls.filter((c) => c.use === "voice")).toHaveLength(1);
  expect(third).toEqual(second);
  // Only the summary, which arrived in the background, may differ from the first answer.
  expect({ ...second, fields: [] }).toEqual({ ...first, fields: [] });
  expect((await narrator.ledger(dossier.day)).uses.voice?.hits).toBe(2);
  for (const c of [first, second, third]) expect(problems(c, names)).toEqual([]);

  const plainDay = setup();
  const a = cardOf(await plainDay.voice.talk(conversation({ folded: false }), USER, SERVER));
  const b = cardOf(await plainDay.voice.talk(conversation({ folded: false }), USER, SERVER));
  expect(b).toEqual(a);
  expect(plainDay.m.calls).toHaveLength(1);
});

test("a voiced last line shows only while the world's last line is the one it replaced", async () => {
  let n = 0;
  const { voice, store } = setup({
    voice: (s) => ({
      ...told(s),
      last: `Ada Mercer had said, warily, that you were a stranger${"!".repeat(++n)}`,
    }),
  });
  const quote = (r: { conv: api.Conversation }) =>
    cardOf(r).description!.match(/Last time: "(.*)"/)?.[1];

  const day9 = await voice.talk(conversation({ folded: false }), USER, SERVER);
  const voiced = "Ada Mercer had said, warily, that you were a stranger!";
  expect(quote(day9)).toBe(voiced);
  const npcId = day9.conv.npc.id;
  expect(JSON.parse((await store.get(lastKey(npcId, USER)))!)).toEqual({
    template: lastLine,
    voiced,
  });

  // The next day voices afresh, but what was said last time stays as it was told.
  const day10 = await voice.talk(conversation({ folded: false, day: 10 }), USER, SERVER);
  expect(quote(day10)).toBe(voiced);

  // Once the world's last line moves on, the stored one is not shown, and the new one is kept.
  const moved = "Ada Mercer passes on the talk of Pylon Camp: Mags Rask speaks well of you.";
  const day11 = await voice.talk(
    conversation({ folded: false, day: 11, last: moved }),
    USER,
    SERVER,
  );
  expect(quote(day11)).toBe("Ada Mercer had said, warily, that you were a stranger!!!");
  expect(JSON.parse((await store.get(lastKey(npcId, USER)))!).template).toBe(moved);

  // When the voice falls back, the world's line is shown, not a stored one.
  const off = voiceNarration(
    new Narrator({ model: null, store, switch: fixedSwitch(true), dayUsd: 1, log: () => {} }),
    store,
    lex,
    fixedSwitch(true),
  );
  const fellBack = await off.talk(
    conversation({ folded: false, day: 12, last: moved }),
    USER,
    SERVER,
  );
  expect(quote(fellBack)).toBe(moved);
});

test("a memory past its cap is summed up once an NPC a world day, listed until then", async () => {
  const { voice, m, store } = setup();
  const c = conversation();
  const npcId = c.npc.id;
  const listed = memoryLines(dossier, lex).join("\n");

  const first = await voice.talk(c, USER, SERVER);
  expect(first.remembers).toBe(listed);
  expect(listed).toContain("Day 2: You greeted them.");
  expect(listed).not.toContain("c-77");
  await voice.idle();
  const summary = await store.get(summaryKey(npcId));
  expect(summary).toBe(`${c.npc.name} remembers more than they can tell, the oldest of it best.`);
  expect(await store.get(summaryDayKey(npcId))).toBe(String(dossier.day));

  const again = await voice.talk(c, USER, SERVER);
  expect(again.remembers).toBe(summary!);
  await voice.talk(conversation({ digest: "other" }), "u-2", SERVER);
  await voice.idle();
  expect(m.calls.filter((x) => x.use === "summary")).toHaveLength(1);
  // The summary reached the voice as context.
  expect(m.calls.filter((x) => x.use === "voice").at(-1)!.user).toContain(summary!);

  // The next day asks again; an unchanged memory is the cached summary, a grown one a new call.
  await voice.talk(conversation({ day: 10 }), USER, SERVER);
  await voice.idle();
  expect(await store.get(summaryDayKey(npcId))).toBe("10");
  expect(m.calls.filter((x) => x.use === "summary")).toHaveLength(1);
  const grown = conversation({ day: 11 });
  grown.dossier = { ...grown.dossier!, folded: [{ type: "greeted", count: 32 }], foldedTotal: 32 };
  await voice.talk(grown, USER, SERVER);
  await voice.idle();
  expect(m.calls.filter((x) => x.use === "summary")).toHaveLength(2);

  const card = cardOf(again);
  expect(card.fields!.at(-1)).toEqual({ name: "Remembers", value: summary! });
  expect(problems(card, names)).toEqual([]);
  expect(problems(cardOf(first), names)).toEqual([]);

  // Nothing folded away: no summary and no field.
  const none = await setup().voice.talk(conversation({ folded: false }), USER, SERVER);
  expect(none.remembers).toBeUndefined();
  expect(cardOf(none).fields!.some((f) => f.name === "Remembers")).toBe(false);
});

test("with the summary switched off, the oldest entries are listed", async () => {
  const sw: Switch = { on: async (use) => use !== "summary" };
  const { voice, m, store } = setup({ sw });
  const c = conversation();
  const r = await voice.talk(c, USER, SERVER);
  await voice.idle();
  expect(r.remembers).toBe(memoryLines(dossier, lex).join("\n"));
  expect(r.conv.topics[0]!.id).toBe(longerRoad.id);
  expect(m.calls.map((x) => x.use)).toEqual(["voice"]);
  expect(await store.get(summaryKey(c.npc.id))).toBeNull();
  expect(problems(cardOf(r), names)).toEqual([]);
});

test("a summary stored before the switch went off is neither shown nor sent to the voice", async () => {
  const sw: Switch = { on: async (use) => use !== "summary" };
  const { voice, m, store } = setup({ sw });
  const c = conversation();
  const stale = `${c.npc.name} remembers a stale summary.`;
  await store.set(summaryKey(c.npc.id), stale, 60);
  const r = await voice.talk(c, USER, SERVER);
  await voice.idle();
  expect(r.remembers).toBe(memoryLines(dossier, lex).join("\n"));
  expect(m.calls.some((x) => x.use === "summary")).toBe(false);
  expect(m.calls.filter((x) => x.use === "voice").at(-1)!.user).not.toContain(stale);
  expect(await store.get(summaryDayKey(c.npc.id))).toBeNull();
});

test("a long memory is cut at whole lines to fit its field", () => {
  const long = Array.from({ length: 40 }, (_, i) => `Day ${i}: You greeted them at length.`).join(
    "\n",
  );
  const card = talkCard(o, conversation(), undefined, undefined, long);
  const f = card.fields!.find((x) => x.name === "Remembers")!;
  expect(f.value.length).toBeLessThanOrEqual(1024);
  expect(long.startsWith(f.value)).toBe(true);
  expect(f.value.endsWith("at length.")).toBe(true);
  expect(problems(card, names)).toEqual([]);
});

test("the flow asks for the dossier and shows the voiced card; off, the card is as before", async () => {
  const asked: { dossier?: boolean }[] = [];
  const recorded = (samples["act:talk"] as { reply: api.ActionReply }).reply;
  const world = {
    act: async () => ({ ok: true, reply: recorded }),
    player: async () => "c-1",
    options: async () => o,
    here: async () => mm8.here,
    npc: async (_c: string, _n: string, opts?: { dossier?: boolean }) => {
      asked.push(opts ?? {});
      const c = conversation();
      return { ok: true, reply: opts?.dossier ? c : plain(c) };
    },
  } as unknown as World;
  const press = {
    id: { action: "talk" as const, target: conversation().npc.id, version: o.version },
    user: USER,
    guild: SERVER,
    interaction: "i-1",
  };
  const plainCard = (await answer({ world, lex, threatLine: 600 }, press)).card;

  const on = setup();
  const ctx: Ctx = {
    world,
    lex,
    threatLine: 600,
    narration: createNarration({ ...on.voice }),
    narrator: on.narrator,
    day: dayClock(),
  };
  const voiced = (await answer(ctx, press)).card;
  expect(asked.at(-1)).toEqual({ dossier: true });
  expect(voiced.description).toContain("squints at the road");
  expect(voiced.fields!.at(-1)!.name).toBe("Remembers");
  expect(problems(voiced, names)).toEqual([]);
  expect(ctx.day!.today()).toBe(dossier.day);

  const off = setup({ sw: fixedSwitch(false) });
  const offCtx: Ctx = {
    ...ctx,
    narration: createNarration({ ...off.voice }),
    narrator: off.narrator,
  };
  expect((await answer(offCtx, press)).card).toEqual(plainCard);
  expect(asked.at(-1)).toEqual({ dossier: false });
  expect(off.m.calls).toHaveLength(0);
  await on.voice.idle();
});
