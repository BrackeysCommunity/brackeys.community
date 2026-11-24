import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  type DayLedger,
  fixedSwitch,
  memoryStore,
  type NarrateCtx,
  type Narrated,
  type NarrationModel,
  Narrator,
  stubModel,
  upperMicros,
  type UseConfig,
  type UseId,
  type UseSpec,
  USE_CONFIG,
  USES,
} from "../../../packages/mmo-narrate/src/index.ts";
import { chronicleUse } from "../../../packages/mmo-narrate/src/uses/chronicle.ts";
import { digestUse } from "../../../packages/mmo-narrate/src/uses/digest.ts";
import { namesUse, type NamesIn } from "../../../packages/mmo-narrate/src/uses/names.ts";
import { poolUse } from "../../../packages/mmo-narrate/src/uses/pool.ts";
import { proposalsUse } from "../../../packages/mmo-narrate/src/uses/proposals.ts";
import { recapUse } from "../../../packages/mmo-narrate/src/uses/recap.ts";
import { screenUse } from "../../../packages/mmo-narrate/src/uses/screen.ts";
import { stageUse } from "../../../packages/mmo-narrate/src/uses/stage.ts";
import { summaryUse } from "../../../packages/mmo-narrate/src/uses/summary.ts";
import { voiceUse } from "../../../packages/mmo-narrate/src/uses/voice.ts";
import {
  callsPerDay,
  SCALES,
  type ScaleId,
  VOLUME,
} from "../../../packages/mmo-narrate/src/volume.ts";
import { WASTELAND_ENCOUNTERS } from "../../../packages/mmo-words/src/encounters.ts";
import type * as api from "../src/api.ts";
import { dungeonNaming, kindNameFacts, promotionNaming } from "../src/narration/names.ts";
import { chronicleInput, recapInput, stageInput } from "../src/narration/story.ts";
import { summaryInput } from "../src/narration/voice.ts";
import * as mm8 from "../test/fixtures/mm8.ts";
import * as mm9 from "../test/fixtures/mm9.ts";
import * as mm10 from "../test/fixtures/mm10.ts";
import * as naming from "../test/fixtures/mm11-naming.ts";
import * as story from "../test/fixtures/mm11-story.ts";
import * as voice from "../test/fixtures/mm11-voice.ts";
import samplesJson from "../test/fixtures/world.json";
import { seasonLedger } from "./arc-proposals.ts";
import { checkoutBand, digestTables } from "./balance-digest.ts";
import { loadBook, poolRequests } from "./encounter-pool.ts";
import { dollars } from "./narration-ledger.ts";

/**
 * What narration costs a world day:
 *
 *   bun run scripts/narration-cost.ts [--stub] --out <dir>
 *   bun run scripts/narration-cost.ts --real --calls N --usd X --out <dir>
 *
 * Every use's real prompt is built from the bot's fixture wire values, run
 * through the Narrator on a memory store, and the ledger is read back, so
 * the dollars a call are the ledger's own arithmetic. Multiplied by
 * volume.ts at both scales, they are written to cost.md and cost.json.
 *
 * --stub (the default) never leaves the process. --real reads
 * ANTHROPIC_API_KEY, makes at most REAL_MOST_CALLS calls, and stops before any call
 * whose upper estimate would carry the run past --usd; its figures are
 * written beside the stub's as real.md and real.json.
 */

const lex = naming.lex;

/** The world day every measured call is counted under. */
const COST_DAY = 0;
/** Most calls and dollars a real run may be given. */
export const REAL_MOST_CALLS = 30;
export const REAL_MOST_USD = 0.5;
/** What a real run samples of each use, in the order they are interleaved. */
export const REAL_SAMPLE: Partial<Record<UseId, number>> = {
  chronicle: 8,
  stage: 4,
  recap: 6,
  voice: 6,
  names: 3,
  summary: 2,
  screen: 1,
};
/** The stub spends nothing, so its budget only has to clear every sample. */
const STUB_DAY_USD = 1_000;

/** One prompt a use is measured on. */
export interface Sample {
  use: UseId;
  label: string;
  /** The prompt's characters, for the upper estimate. */
  chars(): number;
  run(narrator: Narrator, ctx: NarrateCtx): Promise<Narrated<unknown>>;
}

function sample<I, O>(spec: UseSpec<I, O>, label: string, input: I): Sample {
  return {
    use: spec.use,
    label,
    chars() {
      const p = spec.prompt(input);
      return p.system.length + p.user.length;
    },
    run: (narrator, ctx) => narrator.narrate(spec, input, ctx),
  };
}

// --- the fixture prompts ---------------------------------------------------------

/** The same day's lines a few days on: a real prompt shape with its own cache key. */
function chronicles(): [string, api.Chronicle][] {
  const base: [string, api.Chronicle][] = [
    ["mm9 day", mm9.chronicle],
    ["mm11 day", story.chronicle],
    ["mm11 day elsewhere", story.elsewhere],
  ];
  const later = [1, 2].flatMap((k) =>
    base.map(([l, ch]): [string, api.Chronicle] => [
      `${l}, ${k} later`,
      { ...ch, day: ch.day + k },
    ]),
  );
  return [...base, ...later];
}

function recaps(): [string, api.Recap][] {
  const told = (lines: api.RecapLine[], day: number, names: Record<string, string>) => ({
    ...story.recap(6, lines),
    day,
    names,
  });
  const mm10Names = { ...story.names, ...mm10.names };
  return [
    ["mm9 return", told(mm9.recap.lines, 6, story.names)],
    ["mm9 return, later news", told([...mm9.recap.lines, ...story.later], 6, story.names)],
    ["a held trouble", told(story.later, 7, story.names)],
    ["mm10 promotions", told(mm10.recap.lines, 8, mm10Names)],
    ["mm10 and mm9", told([...mm10.recap.lines, ...mm9.recap.lines], 8, mm10Names)],
    ["mm9 first line", told(mm9.recap.lines.slice(0, 1), 9, story.names)],
  ];
}

/** A kind's facts, as the naming card reads them. */
function kindNames(k: api.Known): NamesIn {
  return { subject: "kind", id: k.kind, plain: k.name, ...kindNameFacts(k, lex) };
}

/** A promotion's facts, as the naming card reads them. */
function promotionNames(id: string, f: api.Fact): NamesIn {
  const { plain, facts } = promotionNaming(f, lex);
  return { subject: "promotion", id, plain, ...facts };
}

function dungeonNames(): NamesIn {
  const f = mm8.named.floor!;
  const { plain, facts } = dungeonNaming(f, lex);
  return { subject: "dungeon", id: f.dungeon, plain, ...facts };
}

function promotionsNamed(): NamesIn[] {
  const wanted = ["a style", "a variant", "a material"];
  return mm10.promotions
    .filter(([label]) => wanted.some((w) => label.startsWith(w)))
    .map(([, ev]) => promotionNames(ev.fact.subjects[0]?.id ?? String(ev.fact.id), ev.fact));
}

const STORY_SCHEMA = new URL(
  "../../mmo-world/sheets/schema/story.arcs.schema.json",
  import.meta.url,
);
const STORY_ARCS = new URL("../../mmo-world/sheets/story/arcs.json", import.meta.url);

/** The arc kit as /v1/operator/arc-kit serves it, read from this checkout's sheets. */
async function arcKit(): Promise<api.ArcKit> {
  const schema = await readFile(STORY_SCHEMA, "utf8");
  const rows = (
    JSON.parse(await readFile(STORY_ARCS, "utf8")) as { rows: { id: string; when: string }[] }
  ).rows;
  const effects = (
    JSON.parse(schema) as {
      properties: {
        rows: {
          items: {
            properties: {
              stages: {
                items: {
                  properties: { lapse: { items: { properties: { kind: { enum: string[] } } } } };
                };
              };
            };
          };
        };
      };
    }
  ).properties.rows.items.properties.stages.items.properties.lapse.items.properties.kind.enum;
  return {
    season: 1,
    templates: rows.map((r) => r.id),
    when: [...new Set(rows.map((r) => r.when))].sort(),
    effects,
    schema,
  };
}

/** The operator dashboards a digest reads, at a small world's size. */
const economy: api.Economy = { active: 50, supply: 19_000, perActive: 380, rate: 60, flagged: [] };
const emergence: api.Emergence = {
  day: 7,
  season: 0,
  active: 50,
  kindsPerMille: [120, 90],
  kindsHealthy: true,
  promotions: [
    { type: "style", count: 1 },
    { type: "variant", count: 0 },
  ],
  need: 1,
  promotionsHealthy: false,
  heavy: 12,
  heavyPlayer: 8,
  heavyHealthy: true,
  pairing: [],
  pairingHealthy: true,
  traces: [{ type: "reliance", count: 30 }],
  recent: [],
};

function storyView(): api.StoryView {
  return {
    season: mm9.season,
    arcs: [...mm9.arcs.open, ...mm9.arcs.ended, ...mm10.templates],
    boards: [],
  };
}

/** Every use's prompts, built from the fixtures the bot's tests read. */
export async function samples(): Promise<Sample[]> {
  const out: Sample[] = [];
  for (const [label, ch] of chronicles()) {
    out.push(sample(chronicleUse, label, chronicleInput(ch, lex)));
  }
  for (const [label, ev, causes] of story.told) {
    out.push(sample(stageUse, label, stageInput({ ...ev, causes }, lex)));
  }
  for (const [label, r] of recaps()) out.push(sample(recapUse, label, recapInput(r, lex)));

  const voiced = [9, 10, 11, 12, 13, 14].map((day, i) =>
    voice.conversation({ day, folded: i % 2 === 0 }),
  );
  for (const conv of voiced) {
    out.push(sample(voiceUse, `day ${conv.dossier!.day}`, { conv, dossier: conv.dossier! }));
  }

  const named = [kindNames(naming.kind), dungeonNames(), ...promotionsNamed()];
  for (const n of named) out.push(sample(namesUse, `${n.subject} ${n.plain}`, n));

  const d = voice.dossier;
  out.push(
    sample(summaryUse, "the tinker", summaryInput({ npc: voice.npc }, d)),
    sample(
      summaryUse,
      "the tinker, oldest two",
      summaryInput(
        { npc: voice.npc },
        {
          ...d,
          folded: (d.folded ?? []).slice(0, 1),
          oldest: d.oldest.slice(0, 2),
        },
      ),
    ),
  );

  for (const name of ["Rust Tooth", ...named.map((n) => n.plain)]) {
    out.push(sample(screenUse, name, { name }));
  }

  const pool = poolRequests(WASTELAND_ENCOUNTERS, loadBook(), null);
  if (typeof pool === "string") throw new Error(pool);
  for (const p of pool) out.push(sample(poolUse, p.beat, p));

  const kit = await arcKit();
  const sv = storyView();
  const ledger = seasonLedger({
    season: 0,
    range: { from: 0, to: 13 },
    kit,
    story: sv,
    days: [mm9.chronicle, story.chronicle],
    lex,
    ticksPerDay: null,
  });
  out.push(sample(proposalsUse, "season 0", { kit, ledger, season: 0 }));

  const tables = digestTables(
    {
      economy,
      emergence,
      story: sv,
      forum: samplesJson.forum as api.Forum,
      report: null,
      lex,
      today: 7,
      ledgers: null,
    },
    await checkoutBand(),
  );
  out.push(sample(digestUse, "week 0", { week: "World days 0 to 6", tables }));
  return out;
}

// --- measuring --------------------------------------------------------------------

/** Every press waits for its call, so each sample is measured whole. */
const WAIT_FOR_EVERY_CALL: Partial<Record<UseId, Partial<UseConfig>>> = Object.fromEntries(
  USES.map((u) => [u, { waitMs: null }]),
);

/** The offline narrator a measurement runs on: a memory store and every switch on. */
export function costNarrator(model: NarrationModel, dayUsd: number, log: (l: string) => void) {
  return new Narrator({
    model,
    store: memoryStore(),
    switch: fixedSwitch(true),
    dayUsd,
    log,
    config: WAIT_FOR_EVERY_CALL,
  });
}

/** Each sample its own player and NPC, so no per-day cap stops a measurement. */
const ctxFor = (i: number): NarrateCtx => ({ day: COST_DAY, player: `p-${i}`, npc: `n-${i}` });

export interface Measured {
  ledger: DayLedger;
  /** Samples that fell back, by label: the figure covers accepted calls only. */
  fellBack: { use: UseId; label: string; reason: string }[];
}

export async function measure(narrator: Narrator, list: readonly Sample[]): Promise<Measured> {
  const fellBack: Measured["fellBack"] = [];
  for (const [i, s] of list.entries()) {
    const r = await s.run(narrator, ctxFor(i));
    if (!r.ok) {
      fellBack.push({
        use: s.use,
        label: s.label,
        reason: r.check ? `${r.reason} (${r.check})` : r.reason,
      });
    }
  }
  return { ledger: await narrator.ledger(COST_DAY), fellBack };
}

// --- the figure ---------------------------------------------------------------------

export interface UseFigure {
  model: string;
  calls: number;
  /** Tokens over every measured call. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usdMicros: number;
  perCall: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    usdMicros: number;
  };
  perDay: Record<ScaleId, { calls: number; usdMicros: number }>;
  rule: string;
  source: string;
  /** Where the per-call figure came from: this run, or the stub when a real run did not sample it. */
  from: "stub" | "real";
}

export interface Figure {
  method: "stub" | "real";
  uses: Partial<Record<UseId, UseFigure>>;
  totals: Record<ScaleId, number>;
  fellBack: Measured["fellBack"];
  /** A real run's calls, spend and why it stopped early, if it did. */
  real?: { calls: number; usdMicros: number; stopped?: string };
}

const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

/** One use's measured totals, per call and per world day at each scale; null when it made no call. */
function useFigure(use: UseId, l: DayLedger, from: UseFigure["from"]): UseFigure | null {
  const u = l.uses[use];
  if (!u || u.calls === 0) return null;
  const per = (n: number) => n / u.calls;
  const perDay = Object.fromEntries(
    SCALE_IDS.map((s) => {
      const calls = callsPerDay(use, SCALES[s]);
      return [s, { calls, usdMicros: Math.round((calls * u.usdMicros) / u.calls) }];
    }),
  ) as UseFigure["perDay"];
  return {
    model: USE_CONFIG[use].model,
    calls: u.calls,
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    usdMicros: u.usdMicros,
    perCall: {
      input: per(u.input),
      output: per(u.output),
      cacheRead: per(u.cacheRead),
      cacheWrite: per(u.cacheWrite),
      usdMicros: per(u.usdMicros),
    },
    perDay,
    rule: VOLUME[use].formula,
    source: VOLUME[use].source,
    from,
  };
}

/** The figure from a measured ledger; uses it did not measure come from `under`, if given. */
export function figureOf(m: Measured, method: Figure["method"], under?: Figure): Figure {
  const uses: Figure["uses"] = {};
  for (const use of USES) {
    const f = useFigure(use, m.ledger, method) ?? under?.uses[use];
    if (f) uses[use] = f;
  }
  const totals = Object.fromEntries(
    SCALE_IDS.map((s) => [
      s,
      Object.values(uses).reduce((sum, f) => sum + (f?.perDay[s].usdMicros ?? 0), 0),
    ]),
  ) as Figure["totals"];
  return { method, uses, totals, fellBack: m.fellBack };
}

/** The stub's figure: deterministic, with no network. */
export async function stubFigure(): Promise<Figure> {
  const narrator = costNarrator(stubModel(), STUB_DAY_USD, () => {});
  return figureOf(await measure(narrator, await samples()), "stub");
}

const tokens = (n: number) => String(Math.round(n));
const scaleName = (s: ScaleId) =>
  `${SCALES[s].servers === 1 ? "1 server" : `${SCALES[s].servers.toLocaleString("en")} servers`}, ${SCALES[s].players.toLocaleString("en")} players`;

export function costMarkdown(f: Figure): string {
  const rows = USES.filter((u) => f.uses[u]).map((u) => [u, f.uses[u]!] as const);
  const table = (header: string[], body: string[][]) =>
    [
      `| ${header.join(" | ")} |`,
      `| ${header.map(() => "---").join(" | ")} |`,
      ...body.map((r) => `| ${r.join(" | ")} |`),
    ].join("\n");
  const out = [
    `# Narration cost per world day (${f.method === "stub" ? "stub estimate" : "real sample"})`,
    "",
    f.method === "stub"
      ? "Tokens a call are the stub's on real prompts built from the bot's fixture wire values: input is the prompt's characters ÷ 4, output the stub reply's characters ÷ 4 plus the use's thinking allowance. Dollars are the narrator's ledger (packages/mmo-narrate/src/prices.ts), rounded up to whole micro-dollars a call."
      : "Tokens a call are the API's own counts for the sampled uses (cache reads and writes included); uses the sample did not cover keep the stub's figure and are marked so. Dollars are the narrator's ledger.",
    "Calls a world day are the stated assumptions in packages/mmo-narrate/src/volume.ts; once a real world runs, scripts/narration-ledger.ts gives the true counts.",
    "",
    "## A call",
    "",
    table(
      [
        "use",
        "model",
        "calls measured",
        "input tokens a call",
        "output tokens a call",
        "cache read tokens a call",
        "cache write tokens a call",
        "$ a call",
        "from",
      ],
      rows.map(([u, x]) => [
        u,
        x.model,
        String(x.calls),
        tokens(x.perCall.input),
        tokens(x.perCall.output),
        tokens(x.perCall.cacheRead),
        tokens(x.perCall.cacheWrite),
        dollars(Math.round(x.perCall.usdMicros)),
        x.from,
      ]),
    ),
  ];
  for (const s of SCALE_IDS) {
    out.push(
      "",
      `## ${scaleName(s)}`,
      "",
      table(
        ["use", "calls a world day", "$ a call", "$ a world day"],
        [
          ...rows.map(([u, x]) => [
            u,
            String(Number(x.perDay[s].calls.toFixed(3))),
            dollars(Math.round(x.perCall.usdMicros)),
            dollars(x.perDay[s].usdMicros),
          ]),
          ["**total**", "", "", `**${dollars(f.totals[s])}**`],
        ],
      ),
    );
  }
  out.push(
    "",
    "## Calls a world day",
    "",
    "S is servers and P active players.",
    "",
    table(
      ["use", "rule", "source"],
      rows.map(([u, x]) => [u, x.rule, x.source]),
    ),
  );
  if (f.real) {
    out.push(
      "",
      "## The real run",
      "",
      `${f.real.calls} calls, ${dollars(f.real.usdMicros)} spent.${f.real.stopped ? ` Stopped early: ${f.real.stopped}.` : ""}`,
    );
  }
  if (f.fellBack.length) {
    out.push(
      "",
      "## Samples that fell back",
      "",
      "Billed if a reply came back, but not counted as a told line.",
      "",
      ...f.fellBack.map((x) => `- ${x.use} (${x.label}): ${x.reason}`),
    );
  }
  return `${out.join("\n")}\n`;
}

async function writeFigure(dir: string, name: string, f: Figure) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.md`), costMarkdown(f));
  await writeFile(join(dir, `${name}.json`), `${JSON.stringify(f, null, 2)}\n`);
}

// --- the real run -------------------------------------------------------------------

/** The real sample: REAL_SAMPLE's count of each use, interleaved, cut to `calls`. */
export function realSamples(all: readonly Sample[], calls: number): Sample[] {
  const queues = (Object.entries(REAL_SAMPLE) as [UseId, number][]).map(([use, n]) =>
    all.filter((s) => s.use === use).slice(0, n),
  );
  for (const [i, q] of queues.entries()) {
    const [use, n] = Object.entries(REAL_SAMPLE)[i]!;
    if (q.length < n!) throw new Error(`only ${q.length} ${use} prompts for a sample of ${n}`);
  }
  const out: Sample[] = [];
  for (let round = 0; out.length < calls && queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round] && out.length < calls) out.push(q[round]!);
  }
  return out;
}

export interface RealResult {
  figure: Figure;
  stopped?: string;
}

/**
 * The real run: one sample at a time, stopping before any call whose upper
 * estimate would carry the run's spend past usd. The narrator's own day
 * budget is set above it, so this check is the one that binds.
 */
export async function realRun(
  model: NarrationModel,
  calls: number,
  usd: number,
  stub: Figure,
  log: (l: string) => void,
): Promise<RealResult> {
  const capMicros = Math.floor(usd * 1_000_000);
  const narrator = costNarrator(model, usd * 2, log);
  const list = realSamples(await samples(), calls);
  const fellBack: Measured["fellBack"] = [];
  let stopped: string | undefined;
  for (const [i, s] of list.entries()) {
    const cfg = narrator.config(s.use);
    const spent = (await narrator.ledger(COST_DAY)).usdMicros;
    const upper = upperMicros(cfg.model, s.chars(), cfg.maxTokens);
    if (spent + upper > capMicros) {
      stopped = `before ${s.use} (${s.label}): ${dollars(spent)} spent and its upper estimate ${dollars(upper)} would cross ${dollars(capMicros)}`;
      break;
    }
    const r = await s.run(narrator, ctxFor(i));
    if (!r.ok) {
      fellBack.push({
        use: s.use,
        label: s.label,
        reason: r.check ? `${r.reason} (${r.check})` : r.reason,
      });
    }
  }
  const ledger = await narrator.ledger(COST_DAY);
  const made = Object.values(ledger.uses).reduce((n, u) => n + (u?.calls ?? 0), 0);
  const figure = figureOf({ ledger, fellBack }, "real", stub);
  figure.real = { calls: made, usdMicros: ledger.usdMicros, ...(stopped ? { stopped } : {}) };
  return { figure, ...(stopped ? { stopped } : {}) };
}

// --- arguments ----------------------------------------------------------------------

export interface CostArgs {
  mode: "stub" | "real";
  out: string;
  calls: number;
  usd: number;
}

const USAGE =
  "usage: narration-cost.ts [--stub | --real --calls N --usd X] --out <dir>   (--real: N at most 30, X at most 0.50)";

export function parseCostArgs(argv: readonly string[]): CostArgs | string {
  const a: CostArgs = { mode: "stub", out: "", calls: REAL_MOST_CALLS, usd: REAL_MOST_USD };
  let calls: string | undefined;
  let usd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => argv[++i];
    switch (flag) {
      case "--stub":
        a.mode = "stub";
        break;
      case "--real":
        a.mode = "real";
        break;
      case "--out":
        a.out = value() ?? "";
        break;
      case "--calls":
        calls = value();
        break;
      case "--usd":
        usd = value();
        break;
      default:
        return `unknown argument ${flag}\n${USAGE}`;
    }
  }
  if (!a.out) return `--out is required\n${USAGE}`;
  if (a.mode === "stub" && (calls !== undefined || usd !== undefined))
    return `--calls and --usd are for --real\n${USAGE}`;
  if (calls !== undefined) {
    const n = Number(calls);
    if (!Number.isInteger(n) || n < 1) return `--calls must be a whole number of calls, 1 or more`;
    if (n > REAL_MOST_CALLS) return `--calls ${n} is over the cap of ${REAL_MOST_CALLS} calls`;
    a.calls = n;
  }
  if (usd !== undefined) {
    const x = Number(usd);
    if (!Number.isFinite(x) || x <= 0) return `--usd must be a positive number of dollars`;
    if (x > REAL_MOST_USD) return `--usd ${x} is over the cap of $${REAL_MOST_USD.toFixed(2)}`;
    a.usd = x;
  }
  return a;
}

if (import.meta.main) {
  const args = parseCostArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    process.exit(2);
  }
  const out = resolve(args.out);
  const stub = await stubFigure();
  await writeFigure(out, "cost", stub);
  console.log(
    `stub: ${dollars(stub.totals.small)} a world day at ${scaleName("small")}, ${dollars(stub.totals.large)} at ${scaleName("large")}`,
  );
  for (const f of stub.fellBack)
    console.error(`stub sample fell back: ${f.use} (${f.label}): ${f.reason}`);
  console.log(`written ${join(out, "cost.md")} and cost.json`);
  if (args.mode === "real") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.error("--real needs ANTHROPIC_API_KEY in the environment; it is an owner step");
      process.exit(2);
    }
    const { anthropicModel } = await import("../src/narration/anthropic.ts");
    const r = await realRun(anthropicModel(key), args.calls, args.usd, stub, (l) =>
      console.error(l),
    );
    await writeFigure(out, "real", r.figure);
    const real = r.figure.real!;
    console.log(
      `real: ${real.calls} calls, ${dollars(real.usdMicros)} spent; ${dollars(r.figure.totals.small)} a world day at ${scaleName("small")}, ${dollars(r.figure.totals.large)} at ${scaleName("large")}`,
    );
    if (r.stopped) console.log(`stopped ${r.stopped}`);
    console.log(`written ${join(out, "real.md")} and real.json`);
  }
  if (stub.fellBack.length) process.exitCode = 1;
}
