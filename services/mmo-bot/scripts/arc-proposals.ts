import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

import IORedis, { type Redis } from "ioredis";

import {
  fixedSwitch,
  memoryStore,
  type NarrationModel,
  Narrator,
  stubModel,
} from "../../../packages/mmo-narrate/src/index.ts";
import { proposalsUse } from "../../../packages/mmo-narrate/src/uses/proposals.ts";
import * as api from "../src/api.ts";
import { NARRATION_DAY_USD, narrationDayUsd } from "../src/config.ts";
import { Lexicon } from "../src/lexicon.ts";
import { anthropicModel } from "../src/narration/anthropic.ts";
import { redisNarrationStore } from "../src/narration/redis.ts";
import { redisSwitch } from "../src/narration/switch.ts";
import { datum } from "../src/screens/common.ts";
import { chronicleLines } from "../src/screens/story.ts";

/**
 * Arc proposals between seasons (GDD 12.9), for the owner to approve:
 *
 *   bun run scripts/arc-proposals.ts --season N --out <file> [--stub | --real] [--from D --to D]
 *
 * It reads the arc kit and the story view (MMO_OPERATOR_TOKEN) and the
 * season's chronicle days (MMO_API_TOKEN) from MMO_WORLD_URL, asks for at
 * most PROPOSALS_MOST candidate story.arcs rows, and writes them as a
 * story.arcs file for `go run ./cmd/harness proposals -in <file>`. It never
 * writes a sheet: a person approves a row by copying it into the next rules
 * epoch.
 * The stub (the default) makes no model call; --real calls the model once.
 */

export type Got<T> = { ok: true; value: T } | { ok: false; status: number; refusal: api.Refusal };
export type Reader = <T>(path: string, token: string) => Promise<Got<T>>;

/** A GET on the world service with a token; a refusal is a value, an unreachable world an error. */
export function worldReader(base: string, fetcher: typeof fetch = fetch): Reader {
  const root = base.replace(/\/+$/, "");
  return async <T>(path: string, token: string): Promise<Got<T>> => {
    let res: Response;
    try {
      res = await fetcher(root + path, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new Error(
        `world service unreachable at ${root}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const body = (await res.json().catch(() => ({}))) as unknown;
    if (res.ok) return { ok: true, value: body as T };
    const r = body as Partial<api.Refusal>;
    return {
      ok: false,
      status: res.status,
      refusal: { code: r.code ?? "http", message: r.message ?? `status ${res.status}` },
    };
  };
}

/** The value of a read the job cannot go on without. */
export function must<T>(path: string, got: Got<T>): T {
  if (got.ok) return got.value;
  throw new Error(`${path}: ${got.status} ${got.refusal.code}: ${got.refusal.message}`);
}

export type ModelMode = "off" | "stub" | "real";

/**
 * The narrator an offline job runs with. The stub and off never leave the
 * process; real calls the model, and with Redis it counts in the world's
 * ledger and honours the switch, otherwise it keeps its cache in memory.
 */
export function jobNarrator(
  mode: ModelMode,
  opts: {
    redis?: Redis | null;
    dayUsd?: number;
    model?: NarrationModel;
    log?: (l: string) => void;
  } = {},
): Narrator {
  const log = opts.log ?? ((l: string) => console.error(l));
  const dayUsd = opts.dayUsd ?? NARRATION_DAY_USD;
  if (mode !== "real") {
    return new Narrator({
      model: mode === "stub" ? (opts.model ?? stubModel()) : null,
      store: memoryStore(),
      switch: fixedSwitch(mode === "stub"),
      dayUsd,
      log,
    });
  }
  if (!opts.model) throw new Error("a real run needs a model");
  return new Narrator({
    model: opts.model,
    store: opts.redis ? redisNarrationStore(opts.redis) : memoryStore(),
    switch: opts.redis ? redisSwitch(opts.redis, true) : fixedSwitch(true),
    dayUsd,
    log,
  });
}

/** Writes a file, making its folder. */
export async function writeOut(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

/** The bot's settings an offline job shares: the world, its tokens and the budget. */
export function jobEnv(env: Record<string, string | undefined> = process.env) {
  return {
    worldUrl: env.MMO_WORLD_URL?.trim() || "http://localhost:8080",
    apiToken: env.MMO_API_TOKEN?.trim() ?? "",
    operatorToken: env.MMO_OPERATOR_TOKEN?.trim() ?? "",
    redisUrl: env.REDIS_URL?.trim() || undefined,
    dayUsd: narrationDayUsd(env),
  };
}

export interface SeasonDays {
  from: number;
  to: number;
}

/** structural: how far back the job looks for a season's close before it asks for --from and --to. */
const WALK_DAYS = 400;

/**
 * A season's world days. The season running is read from its clock; one
 * before it from its season.closed fact in the chronicle, which names its
 * start and length.
 */
export async function seasonDays(
  season: number,
  last: api.Chronicle,
  chronicle: (day: number) => Promise<api.Chronicle | null>,
): Promise<SeasonDays> {
  const cur = last.season;
  if (cur.days === 0) throw new Error("the world keeps no season clock");
  const start = seasonStart(last);
  if (season === cur.n) return { from: start, to: start + cur.days - 1 };
  if (season > cur.n) throw new Error(`season ${season} has not begun; season ${cur.n} is running`);
  // A season's close lands on the first day of the next, so the close of
  // the one just ended is not readable until that day has closed; then the
  // close before it gives where it began.
  for (let d = Math.min(last.day, start), walked = 0; d >= 0 && walked < WALK_DAYS; d--, walked++) {
    for (const l of (await chronicle(d))?.lines ?? []) {
      const n = datum(l.fact, "season")?.n;
      const from = datum(l.fact, "start")?.n;
      const days = datum(l.fact, "days")?.n;
      if (l.fact.kind !== "season.closed" || n === undefined) continue;
      if (n === season && from !== undefined && days !== undefined) {
        return { from, to: from + days - 1 };
      }
      if (n === season - 1 && season === cur.n - 1 && from !== undefined && days !== undefined) {
        return { from: from + days, to: start - 1 };
      }
      if (n < season) d = -1;
    }
  }
  throw new Error(`season ${season}'s close is not in the chronicle; pass --from and --to`);
}

/** The running season's first world day. */
function seasonStart(last: api.Chronicle): number {
  return last.day + 2 - last.season.day;
}

/** The world's ticks a day, from the running season's close tick: ends = (start + days) × ticks a day. */
function ticksPerDay(last: api.Chronicle): number | null {
  const days = seasonStart(last) + last.season.days;
  return days > 0 && last.season.ends % days === 0 ? last.season.ends / days : null;
}

export interface LedgerIn {
  season: number;
  range: SeasonDays;
  kit: api.ArcKit;
  story: api.StoryView;
  /** The season's closed chronicle days, oldest first. */
  days: api.Chronicle[];
  lex: Lexicon;
  /** Ticks a world day, to place an arc's start; null keeps every arc of the story view. */
  ticksPerDay: number | null;
}

const count = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m].sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
};

const arcState = (a: api.Arc) =>
  a.lapsed
    ? `lapsed at stage ${a.stage + 1} of ${a.stages}`
    : a.outcome
      ? `ended, won by ${a.outcome}`
      : `open at stage ${a.stage + 1} of ${a.stages}`;

/** The season as the proposal reads it: its arcs, the templates cast and not, and the chronicle's days. */
export function seasonLedger(i: LedgerIn): string {
  const { range } = i;
  const arcs = i.story.arcs.filter((a) => {
    if (i.ticksPerDay === null) return true;
    const day = Math.floor(a.began / i.ticksPerDay);
    return day >= range.from && day <= range.to;
  });
  const out = [
    `Season ${i.season}: world days ${range.from} to ${range.to}; ${i.days.length} closed days read.`,
    `The book holds ${i.kit.templates.length} arc templates.`,
    "",
    i.ticksPerDay === null
      ? "Arcs the world holds now (open and lately ended):"
      : "Arcs that began this season:",
  ];
  if (!arcs.length) out.push("- none");
  for (const a of arcs) {
    out.push(`- ${a.template} (${a.scope}) "${a.title}": ${arcState(a)}`);
    for (const s of a.sides) {
      out.push(
        `  side ${s.id} wants ${s.wants}${s.tag ? ` ${s.tag}` : ""}: ${s.filled} of ${s.mark}, ${s.backers} backers, pays ${s.pay} coin`,
      );
    }
  }
  const cast = count(arcs.map((a) => a.template));
  const castSet = new Set(cast.map(([t]) => t));
  out.push(
    "",
    `Templates cast: ${cast.map(([t, n]) => `${t} ${n}`).join(", ") || "none"}`,
    `Templates not cast: ${i.kit.templates.filter((t) => !castSet.has(t)).join(", ") || "none"}`,
  );
  const kinds = count(i.days.flatMap((d) => d.lines.map((l) => l.fact.kind)));
  out.push(
    "",
    `Chronicle lines by kind: ${kinds.map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
    "",
    "The chronicle, day by day (its heaviest lines):",
  );
  for (const d of i.days) {
    const lines = chronicleLines(d, i.lex, i.story.arcs).map((x) => x.text);
    out.push(
      `Day ${d.day}: ${lines.join(" ") || "nothing told"}${d.more ? ` (${d.more} more lines)` : ""}`,
    );
  }
  return out.join("\n");
}

export interface ProposalsJob {
  season: number;
  read: Reader;
  apiToken: string;
  operatorToken: string;
  narrator: Narrator;
  /** Overrides the season's days when the chronicle cannot give them. */
  range?: SeasonDays;
}

export type ProposalsDone =
  | { ok: true; rows: unknown[]; ledger: string; range: SeasonDays }
  | { ok: false; reason: string; ledger: string; range: SeasonDays };

/** Reads the world, builds the ledger and asks for the rows; it writes nothing. */
export async function proposeArcs(job: ProposalsJob): Promise<ProposalsDone> {
  const op = <T>(path: string) => job.read<T>(path, job.operatorToken).then((g) => must(path, g));
  const player = <T>(path: string) => job.read<T>(path, job.apiToken);
  const kit = await op<api.ArcKit>(api.PathArcKit);
  const story = await op<api.StoryView>(api.PathOperatorStory);
  const lex = new Lexicon(must(api.PathLexicon, await player<api.Lexicon>(api.PathLexicon)));
  const last = must(api.PathChronicle, await player<api.Chronicle>(api.PathChronicle));
  const read = new Map<number, api.Chronicle | null>([[last.day, last]]);
  const chronicle = async (day: number) => {
    if (!read.has(day)) {
      const got = await player<api.Chronicle>(`${api.PathChronicle}?day=${day}`);
      if (!got.ok && got.status !== 404) must(api.PathChronicle, got);
      read.set(day, got.ok ? got.value : null);
    }
    return read.get(day) ?? null;
  };
  const range = job.range ?? (await seasonDays(job.season, last, chronicle));
  const days: api.Chronicle[] = [];
  for (let d = range.from; d <= Math.min(range.to, last.day); d++) {
    const ch = await chronicle(d);
    if (ch) days.push(ch);
  }
  const ledger = seasonLedger({
    season: job.season,
    range,
    kit,
    story,
    days,
    lex,
    ticksPerDay: ticksPerDay(last),
  });
  const got = await job.narrator.narrate(
    proposalsUse,
    { kit, ledger, season: job.season },
    { day: Math.min(range.to, last.day) },
  );
  if (!got.ok) {
    return {
      ok: false,
      reason: got.check ? `${got.reason}: ${got.check}` : got.reason,
      ledger,
      range,
    };
  }
  return { ok: true, rows: got.value, ledger, range };
}

/** The rows as a story.arcs file, which the harness's proposals run reads. */
export const proposalsFile = (rows: unknown[]) =>
  `${JSON.stringify({ sheet: "story.arcs", rows }, null, 2)}\n`;

export interface ProposalsArgs {
  season: number;
  out: string;
  mode: "stub" | "real";
  range?: SeasonDays;
}

const USAGE = "usage: arc-proposals.ts --season N --out <file> [--stub | --real] [--from D --to D]";

export function parseProposalsArgs(args: string[]): ProposalsArgs | string {
  let v;
  try {
    v = parseArgs({
      args,
      options: {
        season: { type: "string" },
        out: { type: "string" },
        stub: { type: "boolean" },
        real: { type: "boolean" },
        from: { type: "string" },
        to: { type: "string" },
      },
      strict: true,
    }).values;
  } catch (e) {
    return `${e instanceof Error ? e.message : String(e)}\n${USAGE}`;
  }
  const whole = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : null);
  const season = whole(v.season);
  if (season === null || !v.out) return USAGE;
  if (v.stub && v.real) return "--stub and --real together";
  if ((v.from === undefined) !== (v.to === undefined)) return "--from and --to go together";
  let range: SeasonDays | undefined;
  if (v.from !== undefined) {
    const from = whole(v.from);
    const to = whole(v.to);
    if (from === null || to === null || to < from)
      return "--from and --to are world days, from first";
    range = { from, to };
  }
  return { season, out: resolve(v.out), mode: v.real ? "real" : "stub", range };
}

/**
 * The whole job: read, ask, and write the rows only when there are rows.
 * It returns the exit code and says on `say` what it did.
 */
export async function runArcProposals(
  a: ProposalsArgs,
  deps: {
    read: Reader;
    apiToken: string;
    operatorToken: string;
    narrator: Narrator;
    write?: (path: string, body: string) => Promise<void>;
    say?: (line: string) => void;
  },
): Promise<number> {
  const say = deps.say ?? ((l: string) => console.log(l));
  if (!deps.operatorToken) {
    say("MMO_OPERATOR_TOKEN is not set");
    return 2;
  }
  if (!deps.apiToken) {
    say("MMO_API_TOKEN is not set");
    return 2;
  }
  const done = await proposeArcs({ ...a, ...deps });
  say(`season ${a.season}: world days ${done.range.from} to ${done.range.to}`);
  if (!done.ok) {
    say(`no rows written: the model gave none the check accepts (${done.reason})`);
    return 1;
  }
  await (deps.write ?? writeOut)(a.out, proposalsFile(done.rows));
  say(`wrote ${done.rows.length} candidate story.arcs rows to ${a.out}`);
  say(
    `validate them: (cd services/mmo-world && go run ./cmd/harness proposals -in ${a.out}); approve one by copying it into the next rules epoch's sheets`,
  );
  return 0;
}

if (import.meta.main) {
  const a = parseProposalsArgs(process.argv.slice(2));
  if (typeof a === "string") {
    console.error(a);
    process.exit(2);
  }
  let redis: Redis | null = null;
  try {
    const env = jobEnv();
    let model: NarrationModel | undefined;
    if (a.mode === "real") {
      const key = process.env.ANTHROPIC_API_KEY?.trim();
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      model = anthropicModel(key);
      if (env.redisUrl) {
        redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
        await redis.connect();
      }
    }
    process.exitCode = await runArcProposals(a, {
      read: worldReader(env.worldUrl),
      apiToken: env.apiToken,
      operatorToken: env.operatorToken,
      narrator: jobNarrator(a.mode, { redis, dayUsd: env.dayUsd, model }),
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    redis?.disconnect();
  }
}
