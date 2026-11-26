import { expect, test } from "bun:test";

import type IORedis from "ioredis";

import * as api from "../src/api.ts";
import { problems } from "../src/card.ts";
import { answer, type Ctx } from "../src/flow.ts";
import { forgetUser, type RedisLike } from "../src/forget.ts";
import { decodeId, encodeId } from "../src/ids.ts";
import { Lexicon } from "../src/lexicon.ts";
import { MANIFEST } from "../src/manifest.ts";
import { HELD_KEY } from "../src/narration/names.ts";
import { TESTER_NOTE } from "../src/screens/hub.ts";
import type { World } from "../src/world.ts";
import samples from "./fixtures/world.json";

// The bot's own client is what index.ts hands to forgetUser.
const fromIORedis = (r: IORedis): RedisLike => r;
void fromIORedis;

/** Redis's SCAN MATCH glob, with backslash escapes. */
function globRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "\\") re += `\\${glob[++i] ?? ""}`;
    else if (c === "*") re += ".*";
    else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** A Redis of strings and lists in memory; SCAN pages two keys at a time. */
function fakeRedis(strings: Record<string, string>, lists: Record<string, string[]> = {}) {
  const kv = new Map(Object.entries(strings));
  const ls = new Map(Object.entries(lists).map(([k, v]) => [k, [...v]]));
  const redis: RedisLike = {
    async scan(cursor, _m, pattern, _c, _n) {
      const re = globRegex(pattern);
      const all = [...kv.keys(), ...ls.keys()].sort();
      const at = Number(cursor);
      const page = all.slice(at, at + 2).filter((k) => re.test(k));
      const next = at + 2 >= all.length ? "0" : String(at + 2);
      return [next, page];
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) if (kv.delete(k) || ls.delete(k)) n++;
      return n;
    },
    get: async (k) => kv.get(k) ?? null,
    async set(k, v) {
      kv.set(k, v);
      return "OK";
    },
    lrange: async (k, a, b) => (ls.get(k) ?? []).slice(a, b === -1 ? undefined : b + 1),
    async lrem(k, count, v) {
      const l = ls.get(k) ?? [];
      const kept = l.filter((x) => x !== v);
      expect(count).toBe(0);
      ls.set(k, kept);
      return l.length - kept.length;
    },
  };
  return { redis, kv, ls };
}

const USER = "111222333";
const OTHER = "444555666";
const held = (user: string, name: string) =>
  JSON.stringify({ use: "name-kind", user, target: "k", name, day: 3, guild: "g" });
const party = (id: string, members: string[]) =>
  JSON.stringify({ party: id, state: "open", at: 1, channel: "c", server: "g", members });

test("forgetUser removes the user's cooldown, last lines, caps, held names and party places, and nobody else's", async () => {
  const { redis, kv, ls } = fakeRedis(
    {
      [`mmo-bot:cd:${USER}`]: "3",
      [`mmo-bot:cd:${OTHER}`]: "1",
      [`mmo-narr:last:npc-7:${USER}`]: "Back again.",
      [`mmo-narr:last:npc-9:${USER}`]: "The road was kind?",
      [`mmo-narr:last:npc-7:${OTHER}`]: "Hello.",
      [`mmo-narr:last:npc-7:9${USER}`]: "Not this one.",
      [`mmo-narr:cap:recap:${USER}:12`]: "2",
      [`mmo-narr:cap:voice:${USER}:13`]: "1",
      [`mmo-narr:cap:voice:${OTHER}:13`]: "1",
      [`mmo-narr:cap:voice:npc-7:13`]: "4",
      "mmo-narr:summary:npc-7": "A quiet keeper.",
      "mmo-bot:party:pt-1": party("pt-1", [USER, OTHER]),
      "mmo-bot:party:pt-2": party("pt-2", [OTHER]),
      "mmo-bot:party:open": JSON.stringify(["pt-1", "pt-2"]),
    },
    { [HELD_KEY]: [held(USER, "Rude"), held(OTHER, "Ruder"), held(USER, "Worse"), "not json"] },
  );
  const n = await forgetUser(redis, USER);
  // One cooldown, two last lines, two caps, two held names and one party.
  expect(n).toBe(8);
  expect([...kv.keys()].filter((k) => k.includes(USER))).toEqual([`mmo-narr:last:npc-7:9${USER}`]);
  expect(kv.get(`mmo-bot:cd:${OTHER}`)).toBe("1");
  expect(kv.get(`mmo-narr:cap:voice:npc-7:13`)).toBe("4");
  expect(kv.get("mmo-narr:summary:npc-7")).toBe("A quiet keeper.");
  expect(JSON.parse(kv.get("mmo-bot:party:pt-1")!).members).toEqual([OTHER]);
  expect(JSON.parse(kv.get("mmo-bot:party:pt-1")!).thread).toBeUndefined();
  expect(kv.get("mmo-bot:party:pt-2")).toBe(party("pt-2", [OTHER]));
  expect(kv.get("mmo-bot:party:open")).toBe(JSON.stringify(["pt-1", "pt-2"]));
  expect(ls.get(HELD_KEY)).toEqual([held(OTHER, "Ruder"), "not json"]);
  // A second forget finds nothing more.
  expect(await forgetUser(redis, USER)).toBe(0);
});

test("a user id with glob characters is matched literally", async () => {
  const { redis, kv } = fakeRedis({
    "mmo-narr:last:npc-1:a*": "x",
    "mmo-narr:last:npc-1:ab": "y",
  });
  expect(await forgetUser(redis, "a*")).toBe(1);
  expect([...kv.keys()]).toEqual(["mmo-narr:last:npc-1:ab"]);
});

/** A world with one character until it is forgotten; act answers as a test says. */
function forgetWorld(refusal?: api.Refusal) {
  const writes: api.ActionRequest[] = [];
  const o = samples.options as api.Options;
  let character = "c-1";
  const world = {
    player: async () => character,
    options: async () => ({ ...o, version: 7 }),
    async act(req: api.ActionRequest) {
      writes.push(req);
      if (refusal) return { ok: false as const, refusal };
      character = "";
      return { ok: true as const, reply: samples["act:look"].reply as unknown as api.ActionReply };
    },
  } as unknown as World;
  const forgot: string[] = [];
  let fails = false;
  const ctx: Ctx = {
    world,
    lex: new Lexicon(samples.lexicon as unknown as api.Lexicon),
    threatLine: 600,
    async forget(user) {
      forgot.push(user);
      if (fails) throw new Error("redis down");
    },
  };
  const press = (p: { command?: string; id?: string }, interaction = "i-1") =>
    answer(ctx, {
      user: USER,
      guild: "g",
      interaction,
      command: p.command,
      id: p.id ? decodeId(p.id)! : undefined,
    });
  return { writes, forgot, press, failForget: () => (fails = true), lex: ctx.lex };
}

const buttonIds = (card: { rows: unknown[] }) =>
  (card.rows as { buttons?: { kind: string; customId?: string }[] }[])
    .flatMap((r) => r.buttons ?? [])
    .map((b) => (b.customId ? decodeId(b.customId) : null));

test("/forget-me asks first, then Confirm tells the world and clears the bot's notes", async () => {
  const w = forgetWorld();
  const ask = await w.press({ command: "forget-me" });
  expect(w.writes).toEqual([]);
  expect(w.forgot).toEqual([]);
  expect(ask.card.title).toBe("Forget you and your character?");
  expect(problems(ask.card, w.lex.goodsNames())).toEqual([]);
  for (const part of ["What goes", "What stays, as a traveller", "When"])
    expect(ask.card.fields?.map((f) => f.name)).toContain(part);
  expect(JSON.stringify(ask.card)).toContain("within 7 days");
  expect(ask.card.footer).toContain("cannot be undone");
  expect(buttonIds(ask.card)).toEqual([
    { action: "forget", target: "yes", version: 7 },
    { action: "hub", target: "", version: 7 },
  ]);

  const done = await w.press({ id: encodeId("forget", "yes", 7) }, "i-2");
  expect(w.writes).toEqual([
    {
      interactionId: "i-2",
      characterId: "c-1",
      version: 7,
      kind: api.ActForget,
      server: "g",
      admin: undefined,
      staff: undefined,
      discordId: USER,
    },
  ]);
  expect(w.forgot).toEqual([USER]);
  expect(done.card.title).toBe("You are forgotten");
  expect(done.character).toBeUndefined();
  expect(done.card.rows).toEqual([]);
  expect(problems(done.card, w.lex.goodsNames())).toEqual([]);

  // Once forgotten the world knows no character: /forget-me clears the bot's notes again.
  const again = await w.press({ command: "forget-me" }, "i-3");
  expect(again.card.title).toBe("Nothing of yours to forget");
  expect(w.writes).toHaveLength(1);
  expect(w.forgot).toEqual([USER, USER]);
});

test("a stale or refused forget asks again, an earlier forget counts as done, and a failed clear says so", async () => {
  const stale = forgetWorld({ code: api.CodeStale, message: "stale", version: 9 });
  const asked = await stale.press({ id: encodeId("forget", "yes", 7) });
  expect(asked.card.title).toBe("The world moved on: here is the card as it stands.");
  expect(buttonIds(asked.card)[0]).toEqual({ action: "forget", target: "yes", version: 9 });
  expect(stale.forgot).toEqual([]);

  const busy = forgetWorld({ code: "in-fight", message: "you are in a fight" });
  expect((await busy.press({ id: encodeId("forget", "yes", 7) })).card.title).toBe(
    "You are in a fight",
  );
  expect(busy.forgot).toEqual([]);

  const before = forgetWorld({ code: api.CodeForgotten, message: "already forgotten" });
  expect((await before.press({ id: encodeId("forget", "yes", 7) })).card.title).toBe(
    "You are forgotten",
  );
  expect(before.forgot).toEqual([USER]);

  const down = forgetWorld();
  down.failForget();
  const done = await down.press({ id: encodeId("forget", "yes", 7) });
  expect(done.card.description).toContain("run /forget-me again");
  expect(problems(done.card, down.lex.goodsNames())).toEqual([]);
});

test("/forget-me is a command, and the tester note says the world is kept", () => {
  const c = MANIFEST.find((x) => x.name === "forget-me");
  expect(c?.type).toBe(1);
  expect(c && "default_member_permissions" in c).toBe(false);
  expect(TESTER_NOTE).toContain("This world is kept");
  expect(TESTER_NOTE).toContain("/forget-me removes you");
  expect(TESTER_NOTE).not.toContain("wiped");
});
