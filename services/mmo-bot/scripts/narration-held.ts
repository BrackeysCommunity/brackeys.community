import IORedis from "ioredis";

import { HELD_KEEP, HELD_KEY, type HeldName } from "../src/narration/names.ts";

/**
 * The names the screen held for a person to read, newest first:
 *
 *   bun run scripts/narration-held.ts [--json]
 *
 * It reads REDIS_URL and nothing else, and changes nothing: a held name
 * was never sent to the world, and its player can submit another.
 */

/** One held name as a line: the day, what it would have named, who typed it, and the name. */
export function heldLine(raw: string): string {
  let h: Partial<HeldName>;
  try {
    h = JSON.parse(raw) as Partial<HeldName>;
  } catch {
    return `(unreadable entry) ${raw.slice(0, 80)}`;
  }
  const what = h.target ? `${h.use} ${h.target}` : String(h.use);
  return `day ${h.day ?? "?"} · ${what} · user ${h.user ?? "?"} · ${JSON.stringify(h.name ?? "")}`;
}

export function heldLines(raws: readonly string[]): string[] {
  if (!raws.length) return ["no names are held"];
  return [
    `${raws.length} held (the last ${HELD_KEEP} are kept), newest first:`,
    ...raws.map(heldLine),
  ];
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  if (args.some((a) => a !== "--json")) {
    console.error("usage: narration-held.ts [--json]");
    process.exit(2);
  }
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    console.error("REDIS_URL is not set");
    process.exit(2);
  }
  const redis = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await redis.connect();
    const raws = await redis.lrange(HELD_KEY, 0, -1);
    const parsed = (r: string): unknown => {
      try {
        return JSON.parse(r);
      } catch {
        return { unreadable: r };
      }
    };
    if (json) console.log(JSON.stringify(raws.map(parsed), null, 2));
    else for (const line of heldLines(raws)) console.log(line);
  } catch (e) {
    console.error(`redis: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    redis.disconnect();
  }
}
