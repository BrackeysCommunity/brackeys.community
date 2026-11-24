import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import IORedis, { type Redis } from "ioredis";

import {
  fixedSwitch,
  memoryStore as narrationMemory,
  type NarrationModel,
  Narrator,
  stubModel,
  type Switch,
} from "../../../packages/mmo-narrate/src/index.ts";
import {
  type PoolIn,
  poolKey,
  poolProblems,
  poolUse,
} from "../../../packages/mmo-narrate/src/uses/pool.ts";
import {
  type EncounterPool,
  WASTELAND_ENCOUNTERS,
} from "../../../packages/mmo-words/src/encounters.ts";
import { redisSwitch } from "../src/narration/switch.ts";

/**
 * Regenerates the wasteland encounter pool offline (GDD 15.2):
 *
 *   bun run scripts/encounter-pool.ts [--stub] [--out <file>] [--keys clash,guardian:barrow-warden]
 *   bun run scripts/encounter-pool.ts --real [--usd 3] [--out <file>] [--write]
 *
 * Each key gets POOL_LINES new lines under the same check the committed pool
 * passes. The candidate pool goes to --out (a temporary file by default),
 * never over the committed pool unless --write is given; --write is only
 * taken with --real, so stub text never replaces the authored lines. The
 * stub is the default and never touches the network; --real reads
 * ANTHROPIC_API_KEY, honours the world's narration switch when REDIS_URL
 * is set, and stops at the --usd cap. The pool belongs to no world day,
 * so its spend is printed, never added to a day ledger.
 */

export const COMMITTED = new URL(
  "../../../packages/mmo-words/pools/wasteland.encounters.json",
  import.meta.url,
);
const SHEETS = new URL("../../mmo-world/sheets/", import.meta.url);
const PACK = new URL("../../mmo-world/packs/wasteland/names.json", import.meta.url);

/** The real run's spending cap when --usd is not given. */
const REAL_USD = 3;

export interface PoolArgs {
  mode: "stub" | "real";
  out: string;
  write: boolean;
  keys: string[] | null;
  usd: number;
}

const USAGE =
  "usage: encounter-pool.ts [--stub | --real] [--out <file>] [--keys <key,...>] [--usd <dollars>] [--write]";

/** The arguments, or a message saying what is wrong with them. */
export function parseArgs(argv: readonly string[]): PoolArgs | string {
  const a: PoolArgs = {
    mode: "stub",
    out: join(tmpdir(), "wasteland.encounters.candidate.json"),
    write: false,
    keys: null,
    usd: REAL_USD,
  };
  let usdGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${arg} needs a value`);
      return v;
    };
    try {
      if (arg === "--stub") a.mode = "stub";
      else if (arg === "--real") a.mode = "real";
      else if (arg === "--write") a.write = true;
      else if (arg === "--out") a.out = value();
      else if (arg === "--keys") a.keys = value().split(",").filter(Boolean);
      else if (arg === "--usd") {
        a.usd = Number(value());
        usdGiven = true;
      } else return `unknown argument ${arg}\n${USAGE}`;
    } catch (e) {
      return `${(e as Error).message}\n${USAGE}`;
    }
  }
  if (a.write && a.mode !== "real") return "--write is taken only with --real";
  if (usdGiven && a.mode !== "real") return "--usd is taken only with --real";
  if (!(a.usd > 0)) return "--usd must be a positive number of dollars";
  if (a.keys?.length === 0) return "--keys names no key";
  return a;
}

interface Row {
  id: string;
  tags?: string[];
  [flag: string]: unknown;
}

/** What a request needs from the book and the pack: beat rows, archetype rows, shown names. */
export interface PoolBook {
  beats: Row[];
  archetypes: Row[];
  names: Record<string, string>;
}

export function loadBook(): PoolBook {
  const rows = (file: string) =>
    (JSON.parse(readFileSync(new URL(file, SHEETS), "utf8")) as { rows: Row[] }).rows;
  const pack = JSON.parse(readFileSync(PACK, "utf8")) as { rows: { ref: string; name: string }[] };
  return {
    beats: rows("fights/beats.json"),
    archetypes: rows("creatures/archetypes.json"),
    names: Object.fromEntries(pack.rows.map((r) => [r.ref, r.name])),
  };
}

/** A beat row's true flags as tags: "puzzle", "ends". */
const flags = (r: Row) =>
  Object.entries(r)
    .filter(([, v]) => v === true)
    .map(([k]) => k);

/** The requests for the keys asked (every beat kind by default), or a message naming an unknown key. */
export function poolRequests(
  pool: EncounterPool,
  book: PoolBook,
  keys: readonly string[] | null,
): PoolIn[] | string {
  const out: PoolIn[] = [];
  for (const key of keys ?? book.beats.map((b) => b.id)) {
    const [beat, archetype, extra] = key.split(":");
    const b = book.beats.find((r) => r.id === beat);
    if (!b || extra !== undefined) return `no beat kind for the key ${key}`;
    const c = archetype === undefined ? undefined : book.archetypes.find((r) => r.id === archetype);
    if (archetype !== undefined && !c) return `no archetype for the key ${key}`;
    out.push({
      beat: b.id,
      archetype: c?.id,
      tags: [...flags(b), ...(c?.tags ?? [])],
      have: pool.lines[key] ?? (c ? (pool.lines[b.id] ?? []) : []),
      beatName: book.names[`fights.beats:${b.id}`],
      creatureName: c ? book.names[`creatures.archetypes:${c.id}`] : undefined,
    });
  }
  return out;
}

export interface Regenerated {
  pool: EncounterPool;
  done: string[];
  failed: { key: string; reason: string }[];
}

/**
 * Asks for each request in turn. A key whose reply is refused, fails the
 * check or falls back for any reason keeps the lines it had; the version
 * moves only when some lines did, so every pick moves with them.
 */
export async function regenerate(
  narrator: Narrator,
  pool: EncounterPool,
  requests: readonly PoolIn[],
): Promise<Regenerated> {
  const lines = { ...pool.lines };
  const done: string[] = [];
  const failed: Regenerated["failed"] = [];
  for (const r of requests) {
    const key = poolKey(r);
    const got = await narrator.narrate(poolUse, r, { day: 0 });
    if (got.ok) {
      lines[key] = got.value;
      done.push(key);
    } else {
      failed.push({ key, reason: got.check ? `${got.reason} (${got.check})` : got.reason });
    }
  }
  return {
    pool: { pack: pool.pack, version: done.length ? pool.version + 1 : pool.version, lines },
    done,
    failed,
  };
}

export const poolJson = (p: EncounterPool) => `${JSON.stringify(p, null, 2)}\n`;

/** The offline narrator: a memory store, the switch it is given, and the run's cap as its day's budget. */
export function poolNarrator(
  model: NarrationModel,
  usd: number,
  log = console.log,
  sw: Switch = fixedSwitch(true),
): Narrator {
  return new Narrator({
    model,
    store: narrationMemory(),
    switch: sw,
    dayUsd: usd,
    log,
  });
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    process.exit(2);
  }
  const requests = poolRequests(WASTELAND_ENCOUNTERS, loadBook(), args.keys);
  if (typeof requests === "string") {
    console.error(requests);
    process.exit(2);
  }
  let model: NarrationModel;
  if (args.mode === "real") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.error("--real needs ANTHROPIC_API_KEY in the environment");
      process.exit(2);
    }
    const { anthropicModel } = await import("../src/narration/anthropic.ts");
    model = anthropicModel(key);
  } else {
    model = stubModel();
  }
  let redis: Redis | null = null;
  const redisUrl = process.env.REDIS_URL?.trim();
  if (args.mode === "real" && redisUrl) {
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
  }
  let r: Regenerated;
  let narrator: Narrator;
  try {
    // The stub spends nothing; its ledger is an estimate, so its cap only has to clear one call.
    narrator = poolNarrator(
      model,
      args.mode === "real" ? args.usd : 1_000,
      console.log,
      redis ? redisSwitch(redis, true) : fixedSwitch(true),
    );
    r = await regenerate(narrator, WASTELAND_ENCOUNTERS, requests);
  } finally {
    redis?.disconnect();
  }
  for (const key of r.done) console.log(`${key}: ${r.pool.lines[key]!.length} new lines`);
  for (const f of r.failed) console.log(`${f.key}: kept, ${f.reason}`);
  const spent = (await narrator.ledger(0)).usdMicros / 1_000_000;
  console.log(`${args.mode === "real" ? "spent" : "the stub's estimate"}: $${spent.toFixed(4)}`);
  const problems = poolProblems(r.pool);
  for (const p of problems) console.error(`problem: ${p}`);
  writeFileSync(args.out, poolJson(r.pool));
  console.log(`candidate pool (version ${r.pool.version}) written to ${args.out}`);
  if (args.write) {
    if (problems.length || r.failed.length || !r.done.length) {
      console.error("not written over the committed pool: every key must pass first");
      process.exitCode = 1;
    } else {
      writeFileSync(COMMITTED, poolJson(r.pool));
      console.log(`written over ${COMMITTED.pathname}; review it, then run vp fmt on it`);
    }
  } else if (problems.length || r.failed.length) {
    process.exitCode = 1;
  }
}
