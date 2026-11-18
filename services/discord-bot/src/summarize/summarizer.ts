import { createHash } from "node:crypto";

import {
  DIRECT_LIMIT,
  QUIET_BELOW,
  SINCE_MINE,
  SINCE_MINE_MAX_MS,
  type Span,
  type SummaryWindow,
  WINDOWS,
  bucketStart,
  planWindow,
  snowflakeAt,
  snowflakeTime,
  splitParts,
} from "./buckets.ts";
import type { ReadHistory } from "./history.ts";
import {
  type ModelUsage,
  OUTPUT_TOKENS,
  PROMPT_VERSION,
  type SummaryModel,
  usageCostUsd,
} from "./model.ts";
import { RefTable, numberLinks, resolveLinks, storeLinks } from "./refs.ts";
import {
  type TranscriptMessage,
  formatLines,
  formatStamp,
  resolveTimes,
  toTranscript,
} from "./transcript.ts";

/** The commands used, typed structurally so tests can pass a fake. */
export interface SummaryRedis {
  get(key: string): Promise<string | null>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

export interface Summary {
  /** Empty when nothing was said in the window. */
  text: string;
  /** What the summary covers. */
  from: number;
  to: number;
  messageCount: number;
  finalCached: boolean;
  buckets: { cached: number; summarized: number; raw: number };
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** For the since-my-last-message window: whether that message was found
   *  inside the cap (false means the summary covers the whole cap). Unset
   *  there too when the channel was too busy to search the whole cap. */
  sinceLastPost?: boolean;
}

export interface SummaryOptions {
  now?: number;
  question?: string;
  requesterId?: string;
  /** The asker as the transcript names them, so an answer can tell their own messages apart. */
  requesterName?: string;
  /** The reply goes to the whole channel, which gets the smaller output ceiling. */
  shared?: boolean;
}

interface CachedBucket {
  count: number;
  parts: string[];
}

/** Derived summaries only, never messages, and never kept longer than this. */
const BUCKET_TTL_SECONDS = 30 * 86_400;
/** Several people asking about the same busy channel at once cost one call. */
const FINAL_TTL_SECONDS = 300;
const CHUNK_CONCURRENCY = 6;

const bucketKey = (channelId: string, bucket: number) =>
  `summarize:v${PROMPT_VERSION}:${channelId}:${bucket}`;
/** Bumped on any deletion in the channel, so cached final answers miss. */
export const generationKey = (channelId: string) => `summarize:gen:${channelId}`;

async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

async function pooled<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function header(from: number, to: number, count: number, kind: "raw" | "summary") {
  return `### ${formatStamp(from)} – ${formatStamp(to)} UTC · ${count} messages · ${kind}`;
}

export function createSummarizer(deps: {
  redis: SummaryRedis;
  readHistory: ReadHistory;
  model: SummaryModel;
  /** For the message links the summary cites. */
  guildId: string;
}) {
  const { redis, readHistory, model, guildId } = deps;

  /** `[from, to)`, read newest page first, returned oldest first. */
  async function readRange(channelId: string, from: number, to: number) {
    const messages: TranscriptMessage[] = [];
    let before = snowflakeAt(to);
    for (;;) {
      const page = await readHistory(channelId, before);
      for (const raw of page) {
        if (snowflakeTime(raw.id) < from) return messages.reverse();
        const message = toTranscript(raw);
        if (message) messages.push(message);
      }
      if (page.length < 100) return messages.reverse();
      before = page.at(-1)!.id;
    }
  }

  /** The caller's newest message in the last `SINCE_MINE_MAX_MS`, if any. */
  async function findLastPost(channelId: string, authorId: string, now: number) {
    const floor = now - SINCE_MINE_MAX_MS;
    let before = snowflakeAt(now + 1);
    for (;;) {
      const page = await readHistory(channelId, before);
      for (const raw of page) {
        const at = snowflakeTime(raw.id);
        if (at < floor) return null;
        if (raw.author.id === authorId) return { id: raw.id, at };
      }
      if (page.length < 100) return null;
      before = page.at(-1)!.id;
    }
  }

  /** A summary, or with `question` an answer to it drawn from the same history. */
  async function summarize(
    channelId: string,
    window: SummaryWindow,
    { now = Date.now(), question, requesterId, requesterName, shared = false }: SummaryOptions = {},
  ): Promise<Summary> {
    let start: number;
    let windowKey: string = window;
    let sinceLastPost: boolean | undefined;
    if (window === SINCE_MINE) {
      const post = requesterId ? await findLastPost(channelId, requesterId, now) : null;
      start = post ? post.at + 1 : now - SINCE_MINE_MAX_MS;
      windowKey = `${SINCE_MINE}:${post?.id ?? "none"}`;
      sinceLastPost = Boolean(post);
    } else {
      start = now - WINDOWS[window];
    }
    const usage: ModelUsage[] = [];
    const result = (fields: Partial<Summary>): Summary => ({
      text: "",
      from: start,
      to: now,
      messageCount: 0,
      finalCached: false,
      buckets: { cached: 0, summarized: 0, raw: 0 },
      inputTokens: usage.reduce((sum, u) => sum + u.inputTokens, 0),
      outputTokens: usage.reduce((sum, u) => sum + u.outputTokens, 0),
      costUsd: usage.reduce((sum, u) => sum + usageCostUsd(u), 0),
      sinceLastPost,
      ...fields,
    });

    const [latest] = await readHistory(channelId, snowflakeAt(now + 1), 1);
    if (!latest || snowflakeTime(latest.id) < start) return result({});

    const generation = (await quietly(() => redis.get(generationKey(channelId)), null)) ?? "0";
    // An answer is written to its asker, so it is only reused for the same one.
    const asked = question
      ? createHash("sha256")
          .update(`${requesterId ?? ""}\0${question}`)
          .digest("hex")
          .slice(0, 16)
      : "-";
    const maxTokens = shared ? OUTPUT_TOKENS.shared : OUTPUT_TOKENS.private;
    const finalKey = `summarize:final:v${PROMPT_VERSION}:${channelId}:${generation}:${windowKey}:${latest.id}:${asked}:${maxTokens}`;
    const cachedFinal = await quietly(() => redis.get(finalKey), null);
    if (cachedFinal) return { ...(JSON.parse(cachedFinal) as Summary), finalCached: true };

    const spans = planWindow(now, now - start);
    const whole = spans.filter((span) => span.bucket !== null);
    const stored = await quietly(
      async () =>
        whole.length ? redis.mget(...whole.map((s) => bucketKey(channelId, s.bucket!))) : [],
      [] as (string | null)[],
    );
    const hits = new Map<Span, CachedBucket>();
    whole.forEach((span, i) => {
      if (stored[i]) hits.set(span, JSON.parse(stored[i]!) as CachedBucket);
    });

    // Contiguous spans with no cached summary are read in one pass each,
    // newest first.
    const ranges: Span[][] = [];
    for (const span of spans) {
      if (hits.has(span)) continue;
      const last = ranges.at(-1);
      if (last && last.at(-1)!.to === span.from) last.push(span);
      else ranges.push([span]);
    }
    const fetched = new Map<Span, TranscriptMessage[]>();
    for (const range of ranges.reverse()) {
      const messages = await readRange(channelId, range[0].from, range.at(-1)!.to);
      for (const span of range) {
        fetched.set(
          span,
          messages.filter((m) => m.at >= span.from && m.at < span.to),
        );
      }
    }

    const count = spans.reduce(
      (sum, span) => sum + (hits.get(span)?.count ?? fetched.get(span)?.length ?? 0),
      0,
    );
    if (count === 0) return result({});

    const buckets = { cached: 0, summarized: 0, raw: 0 };
    type Section =
      | { from: number; to: number; kind: "raw"; messages: TranscriptMessage[] }
      | { from: number; to: number; kind: "summary"; count: number; parts: string[] };
    let sections: Section[];
    if (!spans.some((span) => hits.has(span)) && count <= DIRECT_LIMIT) {
      const all = spans.flatMap((span) => fetched.get(span) ?? []);
      buckets.raw = spans.filter((span) => fetched.get(span)?.length).length;
      sections = [{ from: start, to: now, kind: "raw", messages: all }];
    } else {
      const work = spans.map((span) => async (): Promise<Section | null> => {
        const hit = hits.get(span);
        if (hit) {
          buckets.cached++;
          return { from: span.from, to: span.to, kind: "summary", ...hit };
        }
        const messages = fetched.get(span) ?? [];
        if (!messages.length) return null;
        if (span.bucket === null || messages.length < QUIET_BELOW) {
          buckets.raw++;
          return { from: span.from, to: span.to, kind: "raw", messages };
        }
        const parts = await Promise.all(
          splitParts(messages).map(async (part) => {
            const refs = new RefTable();
            const reply = await model.chunk(formatLines(part, refs));
            usage.push(reply.usage);
            return storeLinks(reply.text, refs);
          }),
        );
        const entry: CachedBucket = { count: messages.length, parts };
        await quietly(
          () =>
            redis.set(
              bucketKey(channelId, span.bucket!),
              JSON.stringify(entry),
              "EX",
              BUCKET_TTL_SECONDS,
            ),
          null,
        );
        buckets.summarized++;
        return { from: span.from, to: span.to, kind: "summary", count: messages.length, parts };
      });
      sections = (await pooled(work, CHUNK_CONCURRENCY)).filter((s): s is Section => s !== null);
    }

    // Numbered in time order once everything is in, so #1 is the oldest.
    const refs = new RefTable();
    const history = sections
      .map((section) =>
        section.kind === "raw"
          ? `${header(section.from, section.to, section.messages.length, "raw")}\n${formatLines(section.messages, refs)}`
          : `${header(section.from, section.to, section.count, "summary")}\n${numberLinks(section.parts.join("\n\n"), refs)}`,
      )
      .join("\n\n");
    const final = question
      ? await model.answer({ question, asker: requesterName }, history, maxTokens)
      : await model.final(history, maxTokens);
    usage.push(final.usage);
    const messageUrl = (id: string) => `https://discord.com/channels/${guildId}/${channelId}/${id}`;
    const summary = result({
      text: resolveTimes(resolveLinks(final.text, refs, messageUrl), now),
      messageCount: count,
      buckets,
    });
    await quietly(
      () => redis.set(finalKey, JSON.stringify(summary), "EX", FINAL_TTL_SECONDS),
      null,
    );
    return summary;
  }

  /** Drops every cached summary that included one of these messages. */
  async function invalidate(channelId: string, messageIds: string[]): Promise<void> {
    const keys = [
      ...new Set(messageIds.map((id) => bucketKey(channelId, bucketStart(snowflakeTime(id))))),
    ];
    await quietly(async () => {
      if (keys.length) await redis.del(...keys);
      await redis.incr(generationKey(channelId));
      await redis.expire(generationKey(channelId), BUCKET_TTL_SECONDS);
    }, undefined);
  }

  /**
   * Members asking for the same summary while one is being made share it,
   * rather than each paging the channel and paying for the model again.
   * Joiners see it as cached, so it is counted once.
   */
  const inFlight = new Map<string, Promise<Summary>>();
  function summarizeShared(
    channelId: string,
    window: SummaryWindow,
    options: Parameters<typeof summarize>[2] = {},
  ): Promise<Summary> {
    const perMember = window === SINCE_MINE || options.question !== undefined;
    const key = [
      channelId,
      window,
      options.question ?? "",
      perMember ? (options.requesterId ?? "") : "",
      options.shared ? "shared" : "private",
    ].join("\0");
    const pending = inFlight.get(key);
    if (pending) return pending.then((summary) => ({ ...summary, finalCached: true }));
    const run = summarize(channelId, window, options).finally(() => inFlight.delete(key));
    inFlight.set(key, run);
    return run;
  }

  return { summarize: summarizeShared, invalidate };
}
