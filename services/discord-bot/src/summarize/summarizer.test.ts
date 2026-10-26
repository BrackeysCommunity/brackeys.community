import { describe, expect, test } from "bun:test";

import { MAX_FETCH, snowflakeAt } from "./buckets.ts";
import type { DiscordApiMessage, ReadHistory } from "./history.ts";
import type { SummaryModel } from "./model.ts";
import { type SummaryRedis, createSummarizer } from "./summarizer.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-26T15:30:00Z");
const CHANNEL = "243005537342586880";
const GUILD = "100000000000000001";

/** A channel with one message at each of `times`, oldest first. */
function channel(times: number[]) {
  const messages: DiscordApiMessage[] = times.map((at, i) => ({
    id: (BigInt(snowflakeAt(at)) + BigInt(i % 4096)).toString(),
    type: 0,
    content: `message ${i}`,
    timestamp: new Date(at).toISOString(),
    author: { id: String(i % 5), username: `user${i % 5}` },
  }));
  let pages = 0;
  const readHistory: ReadHistory = async (_channelId, before, limit = 100) => {
    pages++;
    const cutoff = BigInt(before);
    return messages
      .filter((m) => BigInt(m.id) < cutoff)
      .reverse()
      .slice(0, limit);
  };
  return { messages, readHistory, pages: () => pages };
}

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

function fakeModel() {
  const calls = {
    chunk: [] as string[],
    final: [] as string[],
    answer: [] as { question: string; history: string }[],
    words: [] as number[],
  };
  const usage = { inputTokens: 1000, outputTokens: 100 };
  const model: SummaryModel = {
    chunk: async (transcript) => {
      calls.chunk.push(transcript);
      return {
        text: `[summary of ${transcript.split("\n").length}](#1) and [a made-up one](#99999)`,
        usage,
      };
    },
    final: async (sections, words) => {
      calls.final.push(sections);
      calls.words.push(words);
      return { text: "[the first point](#1) final", usage };
    },
    answer: async (question, history) => {
      calls.answer.push({ question, history });
      return { text: `answer to ${question}`, usage };
    },
  };
  return { model, calls };
}

/** `count` messages spread evenly over `[from, to)`. */
const spread = (from: number, to: number, count: number) =>
  Array.from({ length: count }, (_, i) => from + Math.floor(((to - from) * i) / count));

function setup(times: number[]) {
  const history = channel(times);
  const redis = memoryRedis();
  const { model, calls } = fakeModel();
  const summarizer = createSummarizer({
    redis,
    readHistory: history.readHistory,
    model,
    guildId: GUILD,
  });
  return { ...history, redis, calls, summarizer };
}

const bucketKeys = (redis: { store: Map<string, string> }) =>
  [...redis.store.keys()].filter((key) => /^summarize:v\d+:/.test(key));

describe("summarize", () => {
  test("numbers the history and turns the answer's citations into message links", async () => {
    const { summarizer, calls, messages } = setup(spread(NOW - 20 * HOUR, NOW, 50));
    const summary = await summarizer.summarize(CHANNEL, "24h", { now: NOW });
    expect(calls.final[0]).toContain(
      `#1 [${messages[0].timestamp.slice(5, 16).replace("T", " ")}]`,
    );
    expect(summary.text).toBe(
      `[the first point](https://discord.com/channels/${GUILD}/${CHANNEL}/${messages[0].id}) final`,
    );
    expect(calls.words).toEqual([300]);
  });

  test("cached chunk summaries keep their citations as ids and are renumbered per request", async () => {
    const { summarizer, calls, redis } = setup(spread(NOW - 6 * HOUR, NOW, 600));
    await summarizer.summarize(CHANNEL, "6h", { now: NOW });
    const stored = [...redis.store.entries()].filter(([k]) => /^summarize:v\d+:/.test(k));
    const parts = stored.flatMap(([, v]) => (JSON.parse(v) as { parts: string[] }).parts);
    expect(parts.every((p) => /\]\(<m:\d{17,20}>\)/.test(p))).toBe(true);
    // A number the model made up loses its link instead of pointing nowhere.
    expect(parts.some((p) => p.includes("#99999") || p.includes("(<m:undefined"))).toBe(false);
    expect(parts.join()).toContain("and a made-up one");
    // In the final call they come back as this request's numbers.
    expect(calls.final[0]).toMatch(/\[summary of \d+\]\(#\d+\)/);
    expect(calls.final[0]).not.toContain("<m:");
    expect(calls.words).toEqual([500]);
  });

  test("a question is answered from the same history and cached apart from the summary", async () => {
    const { summarizer, calls } = setup(spread(NOW - 6 * HOUR, NOW, 600));
    const plain = await summarizer.summarize(CHANNEL, "6h", { now: NOW });
    const asked = await summarizer.summarize(CHANNEL, "6h", {
      now: NOW,
      question: "who argued for voting?",
    });
    expect(plain.text).toContain("final");
    expect(asked.text).toBe("answer to who argued for voting?");
    expect(asked.finalCached).toBe(false);
    // Closed buckets were summarized once and shared by both.
    expect(calls.chunk).toHaveLength(2);
    expect(calls.answer[0].history).toContain("· summary");
    const again = await summarizer.summarize(CHANNEL, "6h", {
      now: NOW,
      question: "who argued for voting?",
    });
    expect(again.finalCached).toBe(true);
    const other = await summarizer.summarize(CHANNEL, "6h", {
      now: NOW,
      question: "anything else?",
    });
    expect(other.finalCached).toBe(false);
  });

  test("an empty window calls nothing", async () => {
    const { summarizer, calls } = setup([NOW - 3 * HOUR]);
    const summary = await summarizer.summarize(CHANNEL, "1h", { now: NOW });
    expect(summary.text).toBe("");
    expect(summary.messageCount).toBe(0);
    expect(calls.final).toHaveLength(0);
  });

  test("a small window is one raw call and caches no buckets", async () => {
    const { summarizer, calls, redis } = setup(spread(NOW - 20 * HOUR, NOW, 200));
    const summary = await summarizer.summarize(CHANNEL, "24h", { now: NOW });
    expect(summary.messageCount).toBe(200);
    expect(calls.chunk).toHaveLength(0);
    expect(calls.final).toHaveLength(1);
    expect(calls.final[0]).toContain("200 messages · raw");
    expect(bucketKeys(redis)).toHaveLength(0);
  });

  test("a busy window summarizes closed buckets once and reuses them", async () => {
    const times = spread(NOW - 6 * HOUR, NOW, 600);
    const { summarizer, calls, redis } = setup(times);
    const first = await summarizer.summarize(CHANNEL, "6h", { now: NOW });
    expect(first.buckets.summarized).toBe(2);
    expect(calls.chunk).toHaveLength(2);
    expect(bucketKeys(redis)).toHaveLength(2);
    expect(first.costUsd).toBeGreaterThan(0);

    // A new message changes the newest id, so the final answer misses but
    // the closed buckets don't.
    const later = NOW + 10 * MIN;
    const again = createSummarizer({
      redis,
      readHistory: channel([...times, later - MIN]).readHistory,
      model: fakeModel().model,
      guildId: GUILD,
    });
    const second = await again.summarize(CHANNEL, "6h", { now: later });
    expect(second.buckets.cached).toBe(2);
    expect(second.buckets.summarized).toBe(0);
    expect(second.finalCached).toBe(false);
  });

  test("the same request inside five minutes is served from the final cache", async () => {
    const { summarizer, calls } = setup(spread(NOW - 6 * HOUR, NOW, 600));
    await summarizer.summarize(CHANNEL, "6h", { now: NOW });
    const repeat = await summarizer.summarize(CHANNEL, "6h", { now: NOW + MIN });
    expect(repeat.finalCached).toBe(true);
    expect(calls.final).toHaveLength(1);
  });

  test("quiet closed buckets go to the final call raw", async () => {
    // 10:00–12:00 is a whole closed bucket with five messages.
    const quiet = spread(NOW - 5.5 * HOUR, NOW - 3.5 * HOUR, 5);
    const busy = spread(NOW - 3.5 * HOUR, NOW, 400);
    const { summarizer, calls } = setup([...quiet, ...busy]);
    const summary = await summarizer.summarize(CHANNEL, "6h", { now: NOW });
    expect(summary.buckets.raw).toBeGreaterThan(0);
    expect(calls.final[0]).toContain("10-26 10:00 – 10-26 12:00 UTC · 5 messages · raw");
    expect(calls.chunk.every((t) => t.split("\n").length >= 15)).toBe(true);
  });

  test("a bucket over the part size is summarized in parts", async () => {
    const { summarizer, calls } = setup(spread(NOW - 3.5 * HOUR, NOW - 1.5 * HOUR, 700));
    await summarizer.summarize(CHANNEL, "6h", { now: NOW });
    expect(calls.chunk.map((t) => t.split("\n").length)).toEqual([300, 300, 100]);
  });

  test("a deletion drops the bucket that held it and the cached final answer", async () => {
    const { summarizer, calls, redis, messages } = setup(spread(NOW - 6 * HOUR, NOW, 600));
    await summarizer.summarize(CHANNEL, "6h", { now: NOW });
    const deleted = messages.find((m) => Date.parse(m.timestamp) >= NOW - 3.5 * HOUR)!;
    await summarizer.invalidate(CHANNEL, [deleted.id]);
    expect(bucketKeys(redis)).toHaveLength(1);

    const after = await summarizer.summarize(CHANNEL, "6h", { now: NOW + MIN });
    expect(after.finalCached).toBe(false);
    expect(after.buckets).toMatchObject({ cached: 1, summarized: 1 });
    expect(calls.chunk).toHaveLength(3);
  });

  test("past the read budget it summarizes the newest part and says so", async () => {
    const { summarizer, pages } = setup(spread(NOW - 7 * 24 * HOUR, NOW, MAX_FETCH * 2));
    const summary = await summarizer.summarize(CHANNEL, "7d", { now: NOW });
    expect(summary.truncated).toBe(true);
    expect(summary.from).toBeGreaterThan(NOW - 7 * 24 * HOUR);
    expect(summary.messageCount).toBeLessThanOrEqual(MAX_FETCH);
    expect(pages()).toBeLessThanOrEqual(MAX_FETCH / 100 + 2);
  });
});
