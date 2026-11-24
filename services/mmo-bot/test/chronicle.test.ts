import { expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { type Card, COLOUR, problems } from "../src/card.ts";
import { ChroniclePoster, type ChronicleWorld } from "../src/chronicle.ts";
import { memoryStore } from "../src/forum.ts";
import type { ChannelSink } from "../src/hunts.ts";
import { Lexicon } from "../src/lexicon.ts";
import samples from "./fixtures/world.json";

const lex = new Lexicon({
  ...(samples.lexicon as unknown as Omit<api.Lexicon, "numbers">),
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
const quiet = () => {};

function day(n: number): api.Chronicle {
  return {
    season: { n: 0, day: n + 1, days: 14, band: "opening", ends: 2016 },
    day: n,
    lines: [
      {
        fact: {
          id: 40 + n,
          tick: n * 144 + 20,
          kind: "trouble.held",
          region: "region:0",
          subjects: [{ kind: "settlement", id: "0" }],
          data: [
            { k: "arc", s: "arc-raid" },
            { k: "settlement", n: 0 },
          ],
          weight: 80,
        },
        here: true,
        causes: 1,
      },
    ],
    more: 0,
    earlier: n > 0 ? [n - 1] : [],
  };
}

/** A world whose last closed day is what a test sets; null before any has closed. */
function stubWorld(state: { day: number | null }) {
  const asked: string[] = [];
  const world: ChronicleWorld = {
    async chronicle(server) {
      asked.push(server);
      return state.day === null ? null : day(state.day);
    },
  };
  return { world, asked };
}

function memoryChannel() {
  const posts: Card[] = [];
  const sink: ChannelSink = {
    post: async (c) => (posts.push(c), `msg-${posts.length}`),
    edit: async () => true,
  };
  return { sink, posts };
}

const titled = (ch: api.Chronicle): Card => ({
  context: "Chronicle channel · everyone in the server can see this",
  author: "Chronicle",
  title: `Day ${ch.day + 1}`,
  picture: "form",
  footer: "Open /chronicle for earlier days.",
  rows: [],
  colour: COLOUR.ash,
});

test("a closed day is posted once per server, and a restart posts it no second time", async () => {
  const store = memoryStore();
  const state = { day: null as number | null };
  const { world, asked } = stubWorld(state);
  const { sink, posts } = memoryChannel();
  const poster = new ChroniclePoster(world, lex, store, sink, "guild-a", undefined, quiet, titled);
  // No world day has closed yet.
  expect(await poster.poll()).toBe(0);
  state.day = 0;
  expect(await poster.poll()).toBe(1);
  expect(await poster.poll()).toBe(0);
  const again = new ChroniclePoster(world, lex, store, sink, "guild-a", undefined, quiet, titled);
  expect(await again.poll()).toBe(0);
  expect(posts.map((c) => c.title)).toEqual(["Day 1"]);
  state.day = 1;
  expect(await again.poll()).toBe(1);
  expect(await store.get("mmo-bot:chronicle:guild-a:day")).toBe("1");
  // Another server keeps its own mark and reads with its own places first.
  const other = new ChroniclePoster(world, lex, store, sink, "guild-b", undefined, quiet, titled);
  expect(await other.poll()).toBe(1);
  expect(posts.map((c) => c.title)).toEqual(["Day 1", "Day 2", "Day 2"]);
  expect(asked.at(-1)).toBe("guild-b");
});

test("the day is marked before it is posted, and a post that fails is tried again", async () => {
  const store = memoryStore();
  const { world } = stubWorld({ day: 3 });
  let fail = true;
  const posted: string[] = [];
  const sink: ChannelSink = {
    async post(c) {
      // The mark is already down while the post is in flight.
      expect(await store.get("mmo-bot:chronicle:guild-a:day")).toBe("3");
      if (fail) throw new Error("Discord said no");
      posted.push(c.title);
      return "m";
    },
    edit: async () => true,
  };
  const poster = new ChroniclePoster(world, lex, store, sink, "guild-a", undefined, quiet, titled);
  await expect(poster.poll()).rejects.toThrow("Discord said no");
  expect(await store.get("mmo-bot:chronicle:guild-a:day")).toBeNull();
  fail = false;
  expect(await poster.poll()).toBe(1);
  expect(posted).toEqual(["Day 4"]);
});

test("the chronicle channel's card keeps the card standard", async () => {
  const { world } = stubWorld({ day: 2 });
  const { sink, posts } = memoryChannel();
  await new ChroniclePoster(world, lex, memoryStore(), sink, "guild-a", undefined, quiet).poll();
  expect(posts).toHaveLength(1);
  expect(problems(posts[0]!, names)).toEqual([]);
});

test("every poll that reads a closed day tells the day after it, posted already or not", async () => {
  const { world } = stubWorld({ day: 4 });
  const { sink, posts } = memoryChannel();
  const days: number[] = [];
  const poster = new ChroniclePoster(
    world,
    lex,
    memoryStore(),
    sink,
    "guild-a",
    undefined,
    quiet,
    titled,
    (d) => days.push(d),
  );
  expect(await poster.poll()).toBe(1);
  expect(await poster.poll()).toBe(0);
  expect(posts).toHaveLength(1);
  expect(days).toEqual([5, 5]);
});
