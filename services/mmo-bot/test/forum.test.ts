import { expect, test } from "bun:test";

import type * as api from "../src/api.ts";
import type { Card } from "../src/card.ts";
import { ForumPoster, memoryStore } from "../src/forum.ts";
import { Lexicon } from "../src/lexicon.ts";

const lex = new Lexicon({ names: {}, bands: [], starts: [] } as unknown as api.Lexicon);

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
    reply: async (post, card) => void replies.push([post, card]),
  });
  expect(await poster.poll()).toBe(1);
  expect(await poster.poll()).toBe(0);
  day = 4;
  expect(await poster.poll()).toBe(1);
  expect(opened).toEqual(["Market · Ashford"]);
  expect(replies.map(([p]) => p)).toEqual(["post-1"]);
  expect(replies[0]![1].title).toContain("Day 4");
});
