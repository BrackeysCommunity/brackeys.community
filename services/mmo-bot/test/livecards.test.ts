import { expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import { type Card, COLOUR } from "../src/card.ts";
import { EventsPoster, type EventsWorld } from "../src/events.ts";
import { type ForumStore, memoryStore } from "../src/forum.ts";
import type { ChannelSink } from "../src/hunts.ts";
import { Lexicon } from "../src/lexicon.ts";
import { editDue, LiveCards, type LiveRecord } from "../src/live.ts";

const lex = {} as Lexicon;
const quiet = () => {};

function card(title: string): Card {
  return {
    context: "Events channel · everyone in the server can see this",
    author: "Events",
    title,
    picture: "form",
    footer: "Open /play to take part.",
    rows: [],
    colour: COLOUR.hazard,
  };
}

/** A store whose writes to the keys only names fail once broken is set. */
function breakable(only = (_k: string) => true): { store: ForumStore; broken: { on: boolean } } {
  const inner = memoryStore();
  const broken = { on: false };
  return {
    broken,
    store: {
      get: (k) => inner.get(k),
      set: async (k, v) => {
        if (broken.on && only(k)) throw new Error("store down");
        await inner.set(k, v);
      },
      del: (k) => inner.del(k),
    },
  };
}

/** A channel that breaks the store once it has posted. */
function breakingChannel(broken: { on: boolean }) {
  const posts: string[] = [];
  const sink: ChannelSink = {
    async post(c) {
      posts.push(c.title);
      broken.on = true;
      return `msg-${posts.length}`;
    },
    edit: async () => true,
  };
  return { sink, posts };
}

const raid: api.StoryEvent = {
  fact: {
    id: 11,
    tick: 310,
    kind: "trouble.started",
    subjects: [],
    weight: 80,
    data: [
      { k: "arc", s: "arc-raid" },
      { k: "stage", n: 0 },
    ],
  },
  trouble: {
    arc: "arc-raid",
    kind: "raid",
    title: "A raid",
    banner: "",
    mark: 7,
    defence: 0,
    ends: 400,
  },
  place: "Ashford",
  alarm: true,
};

const raidArc = {
  id: "arc-raid",
  template: "raid",
  title: "A raid",
  scope: "settlement",
  cast: [],
  regions: [],
  seat: { q: 0, r: 0 },
  stage: 0,
  stages: 1,
  due: 400,
  dueDay: 6,
  sides: [],
  began: 300,
} as unknown as api.Arc;

function world(events: api.StoryEvent[]): EventsWorld {
  return {
    async storyEvents(after) {
      const page = events.filter((e) => e.fact.id > after);
      return { events: page, last: Math.max(after, ...page.map((e) => e.fact.id)) };
    },
    arcs: async () => ({
      season: { n: 0, day: 3, days: 14, band: "opening", ends: 2016 },
      open: [raidArc],
      ended: [],
      backing: [],
    }),
    hunts: async () => ({ tick: 320, every: 1 }),
  };
}

test("an event whose record cannot be written after its post is posted once across polls", async () => {
  const { store, broken } = breakable((k) => k.includes(":live:"));
  await store.set("mmo-bot:events:last", "10");
  const { sink, posts } = breakingChannel(broken);
  const poster = new EventsPoster(world([raid]), lex, store, sink, "role", undefined, quiet, (ev) =>
    card(ev.fact.kind),
  );
  await poster.poll().catch(() => {});
  await poster.poll().catch(() => {});
  broken.on = false;
  await poster.poll();
  expect(posts).toEqual(["trouble.started"]);
});

test("a live card whose record cannot be kept is posted once and not tracked", async () => {
  const { store, broken } = breakable();
  const { sink, posts } = breakingChannel(broken);
  const cards = new LiveCards<LiveRecord>(store, sink, "open", quiet, "t");
  const rec = await cards.post("k", { message: "", shown: "a" }, card("one"), undefined, "a");
  expect(rec.message).toBe("msg-1");
  expect(posts).toEqual(["one"]);
  expect(await cards.get("k")).toEqual({ message: "", shown: "a" });
});

test("a failed post takes its mark back", async () => {
  const store = memoryStore();
  const sink: ChannelSink = {
    post: async () => {
      throw new Error("gone");
    },
    edit: async () => true,
  };
  const cards = new LiveCards<LiveRecord>(store, sink, "open", quiet, "t");
  await expect(cards.post("k", { message: "", shown: "a" }, card("one"))).rejects.toThrow("gone");
  expect(await store.get("k")).toBeNull();
});

test("a card is edited no more often than every ticks, and at least a tick apart", () => {
  expect(editDue(10, 10, 0)).toBe(false);
  expect(editDue(10, 11, 0)).toBe(true);
  expect(editDue(10, 12, 3)).toBe(false);
  expect(editDue(10, 13, 3)).toBe(true);
});
