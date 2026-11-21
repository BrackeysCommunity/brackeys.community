import { expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import type { Card } from "../src/card.ts";
import { BoardPoster, ForumPoster, memoryStore } from "../src/forum.ts";
import { Lexicon } from "../src/lexicon.ts";

const lex = new Lexicon({ names: {}, bands: [], starts: [] } as unknown as api.Lexicon);

const noEdit = async (): Promise<boolean> => {
  throw new Error("unexpected edit");
};

test("the forum posts each closed day once, opening a post per settlement first", async () => {
  let day = 3;
  const forum = (): api.Forum => ({
    day,
    posts: [
      {
        settlement: 0,
        name: "Ashford",
        banner: "b",
        trades: [{ what: "Scrap iron", units: 4, price: 9, coin: 36 }],
        movers: [],
      },
    ],
  });
  const opened: string[] = [];
  const replies: [string, Card][] = [];
  const poster = new ForumPoster({ forum: async () => forum() }, lex, memoryStore(), {
    open: async (title) => {
      opened.push(title);
      return "post-1";
    },
    reply: async (post, card) => {
      replies.push([post, card]);
      return true;
    },
    edit: noEdit,
  });
  expect(await poster.poll()).toBe(1);
  expect(await poster.poll()).toBe(0);
  day = 4;
  expect(await poster.poll()).toBe(1);
  expect(opened).toEqual(["Market · Ashford"]);
  expect(replies.map(([p]) => p)).toEqual(["post-1"]);
  expect(replies[0]![1].title).toContain("Day 4");
});

test("a failure partway through a day does not duplicate settlements already posted", async () => {
  const forum: api.Forum = {
    day: 5,
    posts: [
      { settlement: 0, name: "Ashford", banner: "b", trades: [], movers: [] },
      { settlement: 1, name: "Bramwell", banner: "b", trades: [], movers: [] },
    ],
  };
  let failOnce = true;
  const opened: string[] = [];
  const logged: string[] = [];
  const poster = new ForumPoster(
    { forum: async () => forum },
    lex,
    memoryStore(),
    {
      open: async (title) => {
        if (title.includes("Bramwell") && failOnce) {
          failOnce = false;
          throw new Error("503");
        }
        opened.push(title);
        return `post-${opened.length}`;
      },
      reply: async () => {
        throw new Error("unexpected reply");
      },
      edit: noEdit,
    },
    undefined,
    (line) => logged.push(line),
  );
  expect(await poster.poll()).toBe(1);
  expect(logged.join()).toContain("503");
  expect(await poster.poll()).toBe(1);
  expect(await poster.poll()).toBe(0);
  expect(opened).toEqual(["Market · Ashford", "Market · Bramwell"]);
});

test("a post that is gone is opened again", async () => {
  let day = 1;
  const forum = (): api.Forum => ({
    day,
    posts: [{ settlement: 0, name: "Ashford", banner: "b", trades: [], movers: [] }],
  });
  const opened: string[] = [];
  const poster = new ForumPoster({ forum: async () => forum() }, lex, memoryStore(), {
    open: async (title) => {
      opened.push(title);
      return `post-${opened.length}`;
    },
    reply: async () => false,
    edit: noEdit,
  });
  expect(await poster.poll()).toBe(1);
  day = 2;
  expect(await poster.poll()).toBe(1);
  expect(opened).toHaveLength(2);
});

function goal(over: Partial<api.Goal> = {}): api.Goal {
  return {
    id: "q-1",
    title: "Iron for the wall",
    issuer: "character",
    by: "c-1",
    what: "deliver 40 goods of scrap iron",
    verb: "deliver",
    count: 40,
    progress: 0,
    claims: 0,
    reward: 100,
    mode: "pooled",
    lifetime: "ephemeral",
    turnover: "expire",
    state: "live",
    left: 48,
    top: [],
    takes: [],
    ...over,
  } as api.Goal;
}

function boardSink() {
  const calls: string[] = [];
  let posts = 0;
  let gone = false;
  return {
    calls,
    lose: () => void (gone = true),
    sink: {
      open: async (title: string) => {
        calls.push(`open ${title}`);
        return `post-${++posts}`;
      },
      reply: async (post: string, card: Card) => {
        calls.push(`reply ${post} ${card.title}`);
        return true;
      },
      edit: async (post: string, card: Card) => {
        if (gone) return false;
        calls.push(`edit ${post} ${card.fields?.find((f) => f.name === "Progress")?.value}`);
        return true;
      },
    },
  };
}

test("the notice-board forum opens a post per goal, edits it as it moves and closes it once", async () => {
  let posts: api.BoardPost[] = [{ settlement: 0, name: "Ashford", banner: "b", goal: goal() }];
  const { calls, sink } = boardSink();
  let tick = 100;
  const poster = new BoardPoster(
    { board: async () => ({ tick, every: 6, posts }) },
    lex,
    memoryStore(),
    sink,
  );
  expect(await poster.poll()).toBe(1);
  expect(await poster.poll()).toBe(0);
  posts = [{ ...posts[0]!, goal: goal({ progress: 15, claims: 2 }) }];
  tick = 103;
  expect(await poster.poll()).toBe(0);
  tick = 106;
  expect(await poster.poll()).toBe(1);
  posts = [];
  expect(await poster.poll()).toBe(1);
  expect(await poster.poll()).toBe(0);
  expect(calls).toEqual([
    "open Ashford · Iron for the wall",
    "edit post-1 15 of 40 done, 2 claims",
    "reply post-1 Off the board",
  ]);
});

test("a goal whose post is gone is posted again, and a failed post is retried", async () => {
  let posts: api.BoardPost[] = [{ settlement: 0, name: "Ashford", banner: "b", goal: goal() }];
  const { calls, sink, lose } = boardSink();
  let fail = true;
  const logged: string[] = [];
  const poster = new BoardPoster(
    { board: async () => ({ tick: 0, every: 0, posts }) },
    lex,
    memoryStore(),
    {
      ...sink,
      open: async (title) => {
        if (fail) {
          fail = false;
          throw new Error("503");
        }
        return sink.open(title);
      },
    },
    undefined,
    (line) => logged.push(line),
  );
  expect(await poster.poll()).toBe(0);
  expect(logged.join()).toContain("503");
  expect(await poster.poll()).toBe(1);
  lose();
  posts = [{ ...posts[0]!, goal: goal({ progress: 40 }) }];
  expect(await poster.poll()).toBe(1);
  expect(calls).toEqual(["open Ashford · Iron for the wall", "open Ashford · Iron for the wall"]);
});

test("a goal's post is not edited as its time merely ticks down, and its record goes when it closes", async () => {
  let posts: api.BoardPost[] = [
    { settlement: 0, name: "Ashford", banner: "b", goal: goal({ left: 100 }) },
  ];
  const { calls, sink } = boardSink();
  const store = memoryStore();
  let tick = 0;
  const poster = new BoardPoster(
    { board: async () => ({ tick, every: 0, posts }) },
    lex,
    store,
    sink,
  );
  expect(await poster.poll()).toBe(1);
  tick = 1;
  posts = [{ ...posts[0]!, goal: goal({ left: 99 }) }];
  expect(await poster.poll()).toBe(0);
  expect(await store.get("mmo-bot:board:goal:q-1")).not.toBeNull();
  posts = [];
  expect(await poster.poll()).toBe(1);
  expect(await store.get("mmo-bot:board:goal:q-1")).toBeNull();
  expect(calls.filter((c) => c.startsWith("edit"))).toEqual([]);
});

test("a store that fails after a post opened does not open it twice", async () => {
  const posts: api.BoardPost[] = [{ settlement: 0, name: "Ashford", banner: "b", goal: goal() }];
  const { calls, sink } = boardSink();
  const store = memoryStore();
  let sets = 0;
  const poster = new BoardPoster(
    { board: async () => ({ tick: 0, every: 0, posts }) },
    lex,
    {
      ...store,
      set: async (k, v) => {
        if (k.includes("goal:") && ++sets === 2) throw new Error("store down");
        return store.set(k, v);
      },
    },
    sink,
    undefined,
    () => {},
  );
  await poster.poll();
  await poster.poll();
  expect(calls).toEqual(["open Ashford · Iron for the wall"]);
});

test("a goal an operator hid loses its words on its post and its thread", async () => {
  let board: api.Board = {
    tick: 0,
    every: 0,
    posts: [{ settlement: 0, name: "Ashford", banner: "b", goal: goal() }],
  };
  const said: string[] = [];
  const poster = new BoardPoster({ board: async () => board }, lex, memoryStore(), {
    open: async () => "post-1",
    reply: async (post, card) => {
      said.push(`reply ${post}: ${card.title} / ${card.description}`);
      return true;
    },
    edit: async (post, card, title) => {
      said.push(`edit ${post} as ${title}: ${card.title} / ${card.description}`);
      return true;
    },
  });
  await poster.poll();
  board = { tick: 1, every: 0, posts: [], hidden: ["q-1"] };
  expect(await poster.poll()).toBe(1);
  expect(said.length).toBe(2);
  expect(said[0]).toStartWith("edit post-1 as Ashford · off the board");
  expect(said[1]).toStartWith("reply post-1");
  for (const line of said) expect(line).not.toContain("Iron for the wall");
});

test("a goal hidden after it left the board loses its words on its post then", async () => {
  let board: api.Board = {
    tick: 0,
    every: 0,
    posts: [{ settlement: 0, name: "Ashford", banner: "b", goal: goal() }],
  };
  const said: string[] = [];
  const store = memoryStore();
  const poster = new BoardPoster({ board: async () => board }, lex, store, {
    open: async () => "post-1",
    reply: async (post, card) => {
      said.push(`reply ${post}: ${card.title} / ${card.description}`);
      return true;
    },
    edit: async (post, card, title) => {
      said.push(`edit ${post} as ${title}: ${card.title} / ${card.description}`);
      return true;
    },
  });
  await poster.poll();
  // Withdrawn: the thread keeps its name and first card, and the reply says none of its words.
  board = { tick: 1, every: 0, posts: [] };
  expect(await poster.poll()).toBe(1);
  expect(said).toHaveLength(1);
  expect(said[0]).toStartWith("reply post-1");
  expect(said[0]).not.toContain("Iron for the wall");
  expect(await poster.poll()).toBe(0);
  // Hidden a day later: the post is found again and scrubbed, once.
  board = { tick: 2, every: 0, posts: [], hidden: ["q-1"] };
  expect(await poster.poll()).toBe(1);
  expect(said).toHaveLength(2);
  expect(said[1]).toStartWith("edit post-1 as Ashford · off the board");
  expect(said[1]).not.toContain("Iron for the wall");
  expect(await poster.poll()).toBe(0);
  expect(said).toHaveLength(2);
  expect(await store.get("mmo-bot:board:closed:q-1")).toBeNull();
});
