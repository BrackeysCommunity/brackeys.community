import { describe, expect, test } from "bun:test";

import { SUMMARY_TOKEN } from "../commands/custom-id.ts";
import { type PageSet, createSummaryPages, paginate } from "./pages.ts";
import { type SummaryRedis, generationKey } from "./summarizer.ts";

function memoryRedis(): SummaryRedis & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    mget: async (...keys) => keys.map((key) => store.get(key) ?? null),
    set: async (key, value) => void store.set(key, value),
    del: async (...keys) => keys.filter((key) => store.delete(key)).length,
    incr: async (key) => {
      const next = Number(store.get(key) ?? 0) + 1;
      store.set(key, String(next));
      return next;
    },
    expire: async () => 1,
  };
}

const set: PageSet = {
  channelId: "243005537342586880",
  title: "Catch-up: the last 24h",
  footer: "812 messages",
  pages: ["one", "two"],
};

describe("paginate", () => {
  test("cuts at a line break and keeps every line", () => {
    expect(paginate("aaa\nbbb\nccc", 12)).toEqual(["aaa\nbbb", "ccc"]);
    expect(paginate("short", 12)).toEqual(["short"]);
  });

  test("cuts at a space when a line is longer than a page", () => {
    const pages = paginate("alpha beta gamma delta", 15);
    expect(pages).toEqual(["alpha beta", "gamma delta"]);
  });

  test("every page fits, however long the text", () => {
    const text = Array.from({ length: 400 }, (_, i) => `- point ${i}${" word".repeat(30)}`).join(
      "\n",
    );
    const pages = paginate(text);
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) expect(page.length).toBeLessThanOrEqual(4096);
    expect(pages.join("\n")).toBe(text);
  });

  test("a code block that runs past a page is closed there and reopened on the next", () => {
    const code = Array.from({ length: 12 }, (_, i) => `print(${i})`).join("\n");
    const pages = paginate(`Here:\n\`\`\`py\n${code}\n\`\`\`\ndone`, 60);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(60);
      expect((page.match(/^```/gm) ?? []).length % 2).toBe(0);
    }
    expect(pages[1]).toStartWith("```py\n");
    expect(pages.at(-1)).toEndWith("done");
  });
});

describe("summary pages", () => {
  test("a saved set comes back under a token that fits a button id", async () => {
    const pages = createSummaryPages(memoryRedis());
    const token = await pages.save(set);
    expect(token).toMatch(SUMMARY_TOKEN);
    expect(await pages.load(token!)).toEqual(set);
    expect(await pages.load("AAAAAAAAAAAA")).toBeNull();
  });

  test("a deletion in the channel retires its pages", async () => {
    const redis = memoryRedis();
    const pages = createSummaryPages(redis);
    const token = await pages.save(set);
    await redis.incr(generationKey(set.channelId));
    expect(await pages.load(token!)).toBeNull();
  });

  test("a store that is down keeps nothing rather than failing the reply", async () => {
    const down = {
      ...memoryRedis(),
      set: async () => {
        throw new Error("down");
      },
    };
    expect(await createSummaryPages(down).save(set)).toBeNull();
  });
});
