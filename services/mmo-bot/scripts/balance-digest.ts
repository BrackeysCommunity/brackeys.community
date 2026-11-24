import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import IORedis, { type Redis } from "ioredis";

import {
  type DayLedger,
  fixedSwitch,
  type NarrationModel,
  Narrator,
} from "../../../packages/mmo-narrate/src/index.ts";
import { digestUse } from "../../../packages/mmo-narrate/src/uses/digest.ts";
import { num } from "../../../packages/mmo-words/src/units.ts";
import * as api from "../src/api.ts";
import { Lexicon } from "../src/lexicon.ts";
import { anthropicModel } from "../src/narration/anthropic.ts";
import { redisNarrationStore } from "../src/narration/redis.ts";
import {
  type Got,
  jobEnv,
  jobNarrator,
  type ModelMode,
  must,
  type Reader,
  worldReader,
  writeOut,
} from "./arc-proposals.ts";
import { dollars } from "./narration-ledger.ts";

/**
 * The weekly balance digest, for the designer (GDD 18):
 *
 *   bun run scripts/balance-digest.ts --out <file> [--stub | --real | --off] [--day D] [--band LOW-HIGH] [--character ID]
 *
 * It reads /v1/operator/economy, /v1/operator/emergence and
 * /v1/operator/story (MMO_OPERATOR_TOKEN); the market forum's movers, the
 * lexicon and, with --character, the weekly ledger report on that
 * character's market (MMO_API_TOKEN, optional); and the narration ledger for
 * the week (REDIS_URL, optional). It writes markdown tables with units, and
 * paragraphs without numbers above them when narrated; the tables alone
 * otherwise. It never posts anywhere. The stub (the default) and --off make
 * no model call; --real calls the model once.
 */

/** structural: the closed world days a digest covers. */
export const WEEK_DAYS = 7;
/** structural: movers the digest lists at most. */
const MOVERS_SHOWN = 10;

export interface DigestJob {
  read: Reader;
  operatorToken: string;
  apiToken?: string;
  narrator: Narrator;
  /** The narration ledger of a world day; absent when REDIS_URL is unset. */
  ledger?: (day: number) => Promise<DayLedger>;
  /** Coin per active character the stabiliser holds to, and where it was read. */
  band?: { low: number; high: number; from: string } | null;
  /** The world day today; otherwise the forum's or the dashboard's. */
  day?: number;
  /** A character standing in a market, whose read carries the weekly ledger report. */
  character?: string;
}

export interface Digest {
  markdown: string;
  tables: string;
  paragraphs: string[] | null;
  /** Why there are no paragraphs, when there are none. */
  fallback?: string;
}

type Row = (string | number)[];

function table(head: string[], rows: Row[]): string {
  const cell = (c: string | number) =>
    (typeof c === "number" ? num(c) : c).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

const section = (heading: string, ...body: string[]) => [`## ${heading}`, "", ...body].join("\n");

const percentText = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${num(Math.abs(n))}%`;

function bandReading(perActive: number, band: DigestJob["band"]): string {
  if (!band) return "band unknown";
  if (perActive < band.low) return "below the band";
  if (perActive > band.high) return "above the band";
  return "inside the band";
}

export interface DigestReads {
  economy: api.Economy;
  emergence: api.Emergence | null;
  story: api.StoryView;
  forum: api.Forum | null;
  report: api.Report | null;
  lex: Lexicon | null;
  today: number | null;
  ledgers: DayLedger[] | null;
}

/** The report's tables, each under a heading with no number, every figure with its unit. */
export function digestTables(r: DigestReads, band: DigestJob["band"]): string {
  const e = r.economy;
  const report = r.report;
  const coinBand = report
    ? { low: report.low, high: report.high, from: "the weekly ledger report" }
    : band;
  const out: string[] = [];
  out.push(
    section(
      "Coin per active character",
      table(
        ["measure", "value", "unit"],
        [
          ["active characters", e.active, "characters"],
          ["coin held", e.supply, "coin"],
          [
            "coin per active character (the stabiliser's mean)",
            e.perActive,
            "coin per active character",
          ],
          [
            "band",
            coinBand ? `${num(coinBand.low)} to ${num(coinBand.high)}` : "not read",
            coinBand
              ? `coin per active character, from ${coinBand.from}`
              : "coin per active character",
          ],
          ["reading", bandReading(e.perActive, coinBand), "against the band"],
          ["characters flagged for review", e.flagged.length, "characters"],
        ],
      ),
    ),
  );

  const name = (m: string) => r.lex?.material(m) ?? m;
  if (r.forum) {
    const movers = r.forum.posts
      .flatMap((p) => p.movers.map((m) => ({ place: p.name, ...m })))
      .sort(
        (a, b) => Math.abs(b.change) - Math.abs(a.change) || a.material.localeCompare(b.material),
      )
      .slice(0, MOVERS_SHOWN);
    out.push(
      section(
        "Movers and causes",
        `World day ${num(r.forum.day)}, the market forum's day.`,
        "",
        movers.length
          ? table(
              ["settlement", "good", "change", "last price", "cause"],
              movers.map((m) => [
                m.place,
                name(m.material),
                percentText(m.change),
                `${num(m.last)} coin`,
                m.cause || "none kept",
              ]),
            )
          : "No price moved.",
      ),
    );
  } else {
    out.push(
      section("Movers and causes", "Not read: MMO_API_TOKEN is not set or the forum refused."),
    );
  }

  const faucetRows: Row[] = [
    ["faucet rate", e.rate, "coin per active character a world day"],
    ["faucet budget at that rate", e.rate * e.active, "coin a world day"],
  ];
  if (report) {
    faucetRows.push(
      [`faucet paid, the week to world day ${num(report.day)}`, report.faucet, "coin"],
      ["fees taken, the same week", report.fees, "coin"],
      ["net into purses", report.faucet - report.fees, "coin"],
      ["velocity", (report.velocity / 100).toFixed(2), "coin changing hands per coin a world day"],
      ...report.top.map(
        (t, i): Row => [`most traded ${i + 1}`, `${num(t.units)} ${name(t.material)}`, "units"],
      ),
      ["conservation discrepancies", report.audit, "discrepancies"],
    );
  }
  out.push(
    section(
      "Faucets and sinks",
      table(["measure", "value", "unit"], faucetRows),
      ...(report
        ? []
        : [
            "",
            "Fees and coin paid out are in the weekly ledger report, which only a market read serves: pass --character with a character standing in a market.",
          ]),
    ),
  );

  const em = r.emergence;
  if (em) {
    out.push(
      section(
        "Promotions against need and the measures",
        `Season ${num(em.season)}, world day ${num(em.day)}, ${num(em.active)} active characters.`,
        "",
        table(
          ["promotion type", "this season", "need", "unit"],
          em.promotions.map((p) => [p.type, p.count, em.need, "promotions"]),
        ),
        "",
        table(
          ["measure", "value", "healthy"],
          [
            [
              "new kinds per active character a week, newest",
              em.kindsPerMille.length
                ? `${num(em.kindsPerMille.at(-1) ?? 0)} per thousand`
                : "none yet",
              em.kindsHealthy ? "yes" : "no",
            ],
            [
              "promotions against need",
              `${em.promotions.filter((p) => p.count >= em.need).length} of ${em.promotions.length} types at need`,
              em.promotionsHealthy ? "yes" : "no",
            ],
            [
              "heavy facts this season",
              `${num(em.heavy)} facts, ${num(em.heavyPlayer)} of them players'`,
              em.heavyHealthy ? "yes" : "no",
            ],
            [
              "regions with a style they rely on",
              `${num(em.pairing.length)} regions`,
              em.pairingHealthy ? "yes" : "no",
            ],
          ],
        ),
        "",
        table(
          ["trace", "stored", "unit"],
          em.traces.map((t) => [t.type, t.count, "entries"]),
        ),
      ),
    );
  } else {
    out.push(
      section(
        "Promotions against need and the measures",
        "Emergence off: the world keeps no emergence.",
      ),
    );
  }

  const s = r.story;
  const ended = s.arcs.filter((a) => a.outcome || a.lapsed);
  out.push(
    section(
      "Season and arcs",
      table(
        ["measure", "value", "unit"],
        [
          ["season", s.season.n, "season"],
          [
            "season day",
            `${num(s.season.day)} of ${num(s.season.days)}`,
            `world days, ${s.season.band || "no band"}`,
          ],
          ["arcs open", s.arcs.length - ended.length, "arcs"],
          ["arcs ended lately", ended.filter((a) => !a.lapsed).length, "arcs"],
          ["arcs lapsed lately", ended.filter((a) => a.lapsed).length, "arcs"],
        ],
      ),
    ),
  );

  if (r.ledgers) {
    const rows: Row[] = r.ledgers.map((l) => {
      const uses = Object.values(l.uses);
      const sum = (f: (u: NonNullable<(typeof uses)[number]>) => number) =>
        uses.reduce((t, u) => t + (u ? f(u) : 0), 0);
      return [
        l.day,
        sum((u) => u.calls),
        sum((u) => u.hits),
        sum((u) => Object.values(u.fallbacks).reduce((t, n) => t + (n ?? 0), 0)),
        dollars(l.usdMicros),
      ];
    });
    const total = r.ledgers.reduce((t, l) => t + l.usdMicros, 0);
    out.push(
      section(
        "Narration cost per world day",
        table(["world day", "model calls", "cache hits", "fallbacks", "cost in dollars"], rows),
        "",
        `The week: ${dollars(total)}, ${dollars(r.ledgers.length ? Math.round(total / r.ledgers.length) : 0)} a world day.`,
      ),
    );
  } else {
    out.push(
      section(
        "Narration cost per world day",
        r.today === null
          ? "Not read: the world day is unknown (pass --day, or set MMO_API_TOKEN)."
          : "Not read: REDIS_URL is not set.",
      ),
    );
  }
  return out.join("\n\n");
}

const optional = <T>(got: Got<T>): T | null => (got.ok ? got.value : null);

/** Reads the world and the ledger, builds the tables and asks for the paragraphs; it writes nothing. */
export async function balanceDigest(job: DigestJob): Promise<Digest> {
  const op = <T>(path: string) => job.read<T>(path, job.operatorToken);
  const economy = must(api.PathOperatorEconomy, await op<api.Economy>(api.PathOperatorEconomy));
  const em = await op<api.Emergence>(api.PathOperatorEmergence);
  if (!em.ok && !(em.status === 404 && em.refusal.code === api.CodeNotFound)) {
    must(api.PathOperatorEmergence, em);
  }
  const emergence = optional(em);
  const story = must(api.PathOperatorStory, await op<api.StoryView>(api.PathOperatorStory));

  let forum: api.Forum | null = null;
  let lex: Lexicon | null = null;
  let report: api.Report | null = null;
  if (job.apiToken) {
    const player = <T>(path: string) => job.read<T>(path, job.apiToken ?? "");
    forum = optional(await player<api.Forum>(api.PathForum));
    const l = optional(await player<api.Lexicon>(api.PathLexicon));
    lex = l ? new Lexicon(l) : null;
    if (job.character) {
      const m = await player<api.Market>(
        `${api.PathMarket}?characterId=${encodeURIComponent(job.character)}`,
      );
      report = optional(m)?.report ?? null;
    }
  }
  const today = job.day ?? (forum ? forum.day + 1 : (emergence?.day ?? null));
  let ledgers: DayLedger[] | null = null;
  if (job.ledger && today !== null) {
    ledgers = [];
    for (let d = Math.max(0, today - WEEK_DAYS); d < today; d++) ledgers.push(await job.ledger(d));
  }
  const tables = digestTables(
    { economy, emergence, story, forum, report, lex, today, ledgers },
    job.band,
  );
  const week =
    today === null
      ? `The week to season ${story.season.n}, day ${story.season.day}`
      : `World days ${Math.max(0, today - WEEK_DAYS)} to ${today - 1}`;
  const got = await job.narrator.narrate(
    digestUse,
    { week, tables },
    { day: Math.max(0, (today ?? 1) - 1) },
  );
  const paragraphs = got.ok ? got.value : null;
  const markdown = [`# Balance digest: ${week}`, ...(paragraphs ?? []), tables].join("\n\n") + "\n";
  return {
    markdown,
    tables,
    paragraphs,
    fallback: got.ok ? undefined : got.check ? `${got.reason}: ${got.check}` : got.reason,
  };
}

/** The band from this checkout's economy.params, which is the book a world loads unless an epoch moved it. */
export async function checkoutBand(
  path = new URL("../../mmo-world/sheets/economy/params.json", import.meta.url),
): Promise<DigestJob["band"]> {
  try {
    const sheet = JSON.parse(await readFile(path, "utf8")) as {
      rows: { id: string; value: unknown }[];
    };
    const cell = (id: string) => Number(sheet.rows.find((r) => r.id === id)?.value);
    const low = cell("band-low");
    const high = cell("band-high");
    return Number.isFinite(low) && Number.isFinite(high)
      ? { low, high, from: "this checkout's economy.params" }
      : null;
  } catch {
    return null;
  }
}

export interface DigestArgs {
  out: string;
  mode: ModelMode;
  day?: number;
  band?: { low: number; high: number; from: string };
  character?: string;
}

const USAGE =
  "usage: balance-digest.ts --out <file> [--stub | --real | --off] [--day D] [--band LOW-HIGH] [--character ID]";

export function parseDigestArgs(args: string[]): DigestArgs | string {
  let v;
  try {
    v = parseArgs({
      args,
      options: {
        out: { type: "string" },
        stub: { type: "boolean" },
        real: { type: "boolean" },
        off: { type: "boolean" },
        day: { type: "string" },
        band: { type: "string" },
        character: { type: "string" },
      },
      strict: true,
    }).values;
  } catch (e) {
    return `${e instanceof Error ? e.message : String(e)}\n${USAGE}`;
  }
  if (!v.out) return USAGE;
  if ([v.stub, v.real, v.off].filter(Boolean).length > 1)
    return "pick one of --stub, --real and --off";
  const out: DigestArgs = { out: resolve(v.out), mode: v.real ? "real" : v.off ? "off" : "stub" };
  if (v.day !== undefined) {
    if (!/^\d+$/.test(v.day)) return "--day is a world day";
    out.day = Number(v.day);
  }
  if (v.band !== undefined) {
    const m = /^(\d+)-(\d+)$/.exec(v.band);
    if (!m || Number(m[2]) < Number(m[1])) return "--band is LOW-HIGH in coin per active character";
    out.band = { low: Number(m[1]), high: Number(m[2]), from: "--band" };
  }
  if (v.character) out.character = v.character;
  return out;
}

/** The whole job: read, ask, write the report. It returns the exit code. */
export async function runBalanceDigest(
  a: DigestArgs,
  deps: Omit<DigestJob, "band" | "day" | "character"> & {
    band?: DigestJob["band"];
    write?: (path: string, body: string) => Promise<void>;
    say?: (line: string) => void;
  },
): Promise<number> {
  const say = deps.say ?? ((l: string) => console.log(l));
  if (!deps.operatorToken) {
    say("MMO_OPERATOR_TOKEN is not set");
    return 2;
  }
  const d = await balanceDigest({
    ...deps,
    band: a.band ?? deps.band,
    day: a.day,
    character: a.character,
  });
  await (deps.write ?? writeOut)(a.out, d.markdown);
  say(
    d.paragraphs
      ? `wrote the digest with ${d.paragraphs.length} paragraphs to ${a.out}`
      : `wrote the digest's tables alone to ${a.out} (${d.fallback})`,
  );
  return 0;
}

if (import.meta.main) {
  const a = parseDigestArgs(process.argv.slice(2));
  if (typeof a === "string") {
    console.error(a);
    process.exit(2);
  }
  let redis: Redis | null = null;
  try {
    const env = jobEnv();
    if (env.redisUrl) {
      redis = new IORedis(env.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
      await redis.connect();
    }
    let model: NarrationModel | undefined;
    if (a.mode === "real") {
      const key = process.env.ANTHROPIC_API_KEY?.trim();
      if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
      model = anthropicModel(key);
    }
    const books = redis
      ? new Narrator({
          model: null,
          store: redisNarrationStore(redis),
          switch: fixedSwitch(false),
          dayUsd: env.dayUsd,
          log: () => {},
        })
      : null;
    process.exitCode = await runBalanceDigest(a, {
      read: worldReader(env.worldUrl),
      operatorToken: env.operatorToken,
      apiToken: env.apiToken || undefined,
      narrator: jobNarrator(a.mode, {
        redis: a.mode === "real" ? redis : null,
        dayUsd: env.dayUsd,
        model,
      }),
      ledger: books ? (day) => books.ledger(day) : undefined,
      band: await checkoutBand(),
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    redis?.disconnect();
  }
}
