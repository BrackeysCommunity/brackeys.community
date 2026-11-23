import IORedis from "ioredis";

import {
  type DayLedger,
  type FallbackReason,
  fixedSwitch,
  KEY_PREFIX,
  Narrator,
  type UseId,
} from "../../../packages/mmo-narrate/src/index.ts";
import { redisNarrationStore } from "../src/narration/redis.ts";

/**
 * What narration cost, a world day at a time, from the ledger the narrator
 * keeps in Redis (`mmo-narr:cost:{day}`):
 *
 *   bun run scripts/narration-ledger.ts          every day in the ledger
 *   bun run scripts/narration-ledger.ts 12       world day 12
 *   bun run scripts/narration-ledger.ts 10-14    world days 10 to 14
 *
 * It reads REDIS_URL and nothing else, and never calls a model.
 */

const COST_PREFIX = `${KEY_PREFIX}cost:`;

/** The days asked for, or "all"; a message when the argument is not a day or a range. */
export function parseDays(args: readonly string[]): { days: number[] | "all" } | string {
  if (args.length === 0) return { days: "all" };
  const usage = "usage: narration-ledger.ts [day | from-to]";
  if (args.length > 1) return usage;
  const m = /^(\d+)(?:-(\d+))?$/.exec(args[0]!);
  if (!m) return usage;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (to < from) return `the range ${args[0]} ends before it starts`;
  if (to - from > 400) return "a range covers at most 400 days";
  return { days: Array.from({ length: to - from + 1 }, (_, i) => from + i) };
}

/** Micro-dollars as dollars. */
export function dollars(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(6)}`;
}

/** One day's ledger as a table: a row per use, then the day's total. */
export function ledgerLines(l: DayLedger): string[] {
  const header = [
    "use",
    "calls",
    "cache hits",
    "input tokens",
    "output tokens",
    "cache read tokens",
    "cache write tokens",
    "cost",
    "fallbacks",
  ];
  const rows = (Object.entries(l.uses) as [UseId, NonNullable<DayLedger["uses"][UseId]>][])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([use, u]) => [
      use,
      String(u.calls),
      String(u.hits),
      String(u.input),
      String(u.output),
      String(u.cacheRead),
      String(u.cacheWrite),
      dollars(u.usdMicros),
      (Object.entries(u.fallbacks) as [FallbackReason, number][])
        .filter(([, n]) => n > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([r, n]) => `${r} ${n}`)
        .join(", ") || "none",
    ]);
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  const line = (r: string[]) =>
    r
      .map((c, i) => c.padEnd(widths[i]!))
      .join("  ")
      .trimEnd();
  return [
    `world day ${l.day}: ${dollars(l.usdMicros)}`,
    ...(rows.length ? [line(header), ...rows.map(line)] : ["  nothing recorded"]),
  ];
}

if (import.meta.main) {
  const parsed = parseDays(process.argv.slice(2));
  if (typeof parsed === "string") {
    console.error(parsed);
    process.exit(2);
  }
  const { days } = parsed;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    console.error("REDIS_URL is not set");
    process.exit(2);
  }
  const redis = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const narrator = new Narrator({
      model: null,
      store: redisNarrationStore(redis),
      switch: fixedSwitch(false),
      dayUsd: 0,
      log: () => {},
    });
    let list: number[];
    if (days === "all") {
      const found = new Set<number>();
      let cursor = "0";
      do {
        const [next, keys] = await redis.scan(cursor, "MATCH", `${COST_PREFIX}*`, "COUNT", 200);
        cursor = next;
        for (const k of keys) {
          const d = Number(k.slice(COST_PREFIX.length));
          if (Number.isSafeInteger(d)) found.add(d);
        }
      } while (cursor !== "0");
      list = [...found].sort((a, b) => a - b);
      if (!list.length) console.log("the ledger is empty");
    } else list = days;
    let total = 0;
    for (const d of list) {
      const l = await narrator.ledger(d);
      total += l.usdMicros;
      for (const line of ledgerLines(l)) console.log(line);
      console.log("");
    }
    if (list.length > 1) console.log(`${list.length} world days: ${dollars(total)}`);
  } catch (e) {
    console.error(`redis: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    redis.disconnect();
  }
}
