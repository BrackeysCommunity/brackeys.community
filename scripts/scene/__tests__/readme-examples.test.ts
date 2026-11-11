// @vitest-environment node
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatPrefab, formatScene, type SceneDefinition } from "@jams/engine/scene";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { platformerGame } from "../../../src/games/platformer";
import { tacticsGame } from "../../../src/games/tactics";
import { duelGame, field } from "../../engine-readme/examples/duel-game";
import { basin, fountainGame, twinSpout } from "../../engine-readme/examples/fountain-game";
import { meadow, orchardGame } from "../../engine-readme/examples/orchard-game";
import { walkerGame } from "../../engine-readme/examples/walker-game";
import { corridor } from "../../engine-readme/examples/walker-playtest";
import { COMMAND_GROUPS, COMMANDS, runCli, type CommandName } from "../commands";
import type { ToolContext } from "../context";
import { GAME_PRESETS } from "../game-templates";
import { openProject } from "../projects";
import { loadCompatRapier } from "../rapier-compat";
import { cardGame } from "./card-game";
import { tempProject } from "./fixtures";

const repoFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

/** Tracked documents whose scene commands are checked. */
const DOCS = ["scripts/scene/README.md"];

const INVOCATION = /(?:vp run scene|bun scripts\/scene\/cli\.ts) ([^`\n]+)/g;

/** `expect` is the issue code a fenced command reports (` ```sh expect=<code>`), whatever its exit code. */
type Example = { doc: string; line: string; fenced: boolean; argv: string[]; expect?: string };

/** Every scene command in a document: fenced `sh`/`bash` lines, and inline code spans. */
function examples(doc: string, text: string): Example[] {
  const out: Example[] = [];
  const fences = [...text.matchAll(/^```(?:sh|bash)(?: expect=(\S+))?\n([\s\S]*?)^```/gm)];
  for (const [, expect, body] of fences) {
    for (const line of body!.split("\n")) {
      const m = /^(?:vp run scene|bun scripts\/scene\/cli\.ts) (.+)$/.exec(line.trim());
      if (!m) continue;
      out.push({
        doc,
        line: line.trim(),
        fenced: true,
        argv: shellWords(m[1]!),
        ...(expect ? { expect } : {}),
      });
    }
  }
  const prose = text.replace(/^```[\s\S]*?^```/gm, "");
  for (const [, span] of prose.matchAll(/`([^`]+)`/g)) {
    const invocations = [...span!.matchAll(INVOCATION)].map((m) => m[1]!);
    // Bare spans such as `scene diff`, `apply --dry-run` and `assets list`.
    const bare = /^(?:scene )?([a-z]+(?: [a-z][a-z-]*)?)((?: --[a-z-]+(?: [^-\s][^\s]*)?)*)$/.exec(
      span!,
    );
    if (invocations.length === 0 && bare && Object.hasOwn(COMMANDS, bare[1]!))
      invocations.push(`${bare[1]}${bare[2]}`);
    for (const inv of invocations)
      out.push({ doc, line: inv, fenced: false, argv: inv.trim().split(/\s+/) });
  }
  return out;
}

/** Whitespace-separated words, each with the single quotes a shell would strip taken off. */
const shellWords = (line: string) =>
  line
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^'(.*)'$/, "$1"));

/** A command's name and the arguments after it: `assets import x` is `assets import`, then `x`. */
function split(argv: readonly string[]): [string | undefined, string[]] {
  const [first, second, ...more] = argv;
  if (first && second && (COMMAND_GROUPS as readonly string[]).includes(first))
    return [`${first} ${second}`, more];
  return [first, argv.slice(1)];
}

/** Commands that write nothing and need no dev server, as invoked. */
function isPure(argv: string[]): boolean {
  const [name, rest] = split(argv);
  if (rest.includes("--live") || name === "project pull" || name === "project push") return false;
  if (name === "fmt") return rest.includes("--check");
  if (name === "apply" || name?.startsWith("assets "))
    return name === "assets list" || name === "assets info" || rest.includes("--dry-run");
  if (name === "render") return !rest.includes("--out");
  if (name === "project snapshot") return !rest.includes("--out") || rest.includes("-");
  if (name === "game new") return rest.includes("--dry-run");
  // A save writes only its fixture, which `inRoot` moves to the scratch root.
  if (name === "save") return !rest[rest.indexOf("--out") + 1]?.startsWith("scripts/");
  return name !== "new";
}

const placeholder = (arg: string) => arg.startsWith("<") || arg.includes("...");

/**
 * A recording or save fixture a doc example writes and the next one reads,
 * kept in the scratch root, not the repo; one the repo ships under
 * `scripts/` is read where it is. `--out` is a scratch file only for `save`.
 */
const SCRATCH_FLAGS = new Set(["--record", "--run", "--from-save"]);
const inRoot = (argv: readonly string[]) =>
  argv.map((arg, i) => {
    const flag = argv[i - 1];
    const scratch = SCRATCH_FLAGS.has(flag!) || (flag === "--out" && argv[0] === "save");
    return i > 0 && scratch && !arg.startsWith("scripts/") ? join(root, arg) : arg;
  });

/**
 * An op batch in a document: a `json` fence whose info string names what it
 * runs against, `scene=<id>` (`apply --dry-run`) or `project=<id>` (`assets
 * apply --dry-run`), and with `expect=<code>` the issue code it reports.
 * `checks=<scene>` is a checks file instead, which `check <scene> --checks`
 * runs.
 */
type Batch = {
  doc: string;
  line: number;
  target: { scene: string } | { project: string } | { checks: string };
  expect?: string;
  text: string;
};

function batches(doc: string, text: string): Batch[] {
  const out: Batch[] = [];
  for (const m of text.matchAll(/^```json ([^\n]*)\n([\s\S]*?)^```/gm)) {
    const attrs = Object.fromEntries(
      m[1]!
        .trim()
        .split(/\s+/)
        .map((kv) => kv.split("=") as [string, string]),
    );
    const target = attrs.scene
      ? { scene: attrs.scene }
      : attrs.project
        ? { project: attrs.project }
        : attrs.checks
          ? { checks: attrs.checks }
          : null;
    if (!target) continue;
    const line = text.slice(0, m.index).split("\n").length;
    out.push({
      doc,
      line,
      target,
      expect: attrs.expect,
      text: m[2]!,
    });
  }
  return out;
}

/** Every `code` an apply report carries: its refusal's, its issues' and a project batch's. */
function codesIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) codesIn(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "code" && typeof v === "string") out.add(v);
      else codesIn(v, out);
    }
  }
  return out;
}

/** The ops and codes the format-v3 agent surface added or changed: each has a doc example that runs. */
const V3_OPS = [
  "transform",
  "setZ",
  "useAssets",
  "paintCells",
  "setPrefabBase",
  "exposeParam",
  "setParam",
  "setGroup",
  "instantiate",
  "override",
  "applyToPrefab",
  "unpack",
  "createPrefab",
  "definePrefab",
  "update",
];
const V3_CODES = [
  "prefab-cycle",
  "prefab-depth",
  "variant-base-unknown",
  "param-unknown",
  "layer-unknown",
  "behavior-unknown",
  "behavior-forbidden",
  "behavior-missing",
  "grid-invalid",
  "ref-child-unknown",
];
/** The issue codes sprites added. */
const SPRITE_CODES = ["asset-frame-unknown", "sprite-no-asset"];
/** The commands sprites added: each has a doc example that runs. */
const SPRITE_COMMANDS = ["assets info", "bundle"];

/** The codes the world models added, each reproduced by a doc example and listed in the issue table. */
const WORLD_CODES = [
  "tick-rate-invalid",
  "physics-required",
  "physics-skipped",
  "grid-unreachable",
  "nav-invalid",
];

/** The codes entity lifecycle added: a running game throws them, and a doc playtest reproduces each. */
const LIFECYCLE_CODES = ["spawn-id-invalid", "prefab-not-spawnable"];
/** The step events entity lifecycle added, each in the README's table. */
/** The codes input v2 added; the first two are reproduced by a doc example, and all three are in the issue table. */
const INPUT_CODES = ["binding-unknown", "player-unknown"];
const INPUT_LISTED = [...INPUT_CODES, "recording-other-platform"];
/** The units and format v4 codes: `out-of-bounds` reproduced by a px-sized op, `migration-unresolved` listed. */
const UNITS_CODES = ["out-of-bounds"];
const UNITS_LISTED = ["migration-unresolved"];
/** The code `game new` added: reproduced by a doc example and listed in the issue table. */
const GAME_NEW_CODES = ["project-id-taken"];
/** The codes flow and saves added, each in the issue table; the CLI reproduces the first three. */
const FLOW_CODES = ["start-scene-missing", "save-unsupported", "save-version-newer"];
const FLOW_LISTED = [
  ...FLOW_CODES,
  "scene-unlisted",
  "sublevel-invalid",
  "save-too-large",
  "save-slot-limit",
  "save-store-failed",
];
const LIFECYCLE_EVENTS = [
  "entity:spawned",
  "entity:destroyed",
  "entity:enabled",
  "entity:disabled",
  "contact:start",
  "contact:end",
];

/** The card game's scene: a square 0.32 m grid, a painted floor, a lamp and a plain marker. */
const CARD_TABLE: SceneDefinition = {
  v: 4,
  game: cardGame.id,
  name: "card-table",
  bounds: [0, 0, 10.24, 7.68],
  settings: { grid: { kind: "square", cell: [0.32, 0.32] } },
  entities: [
    { id: "floor", type: "tiles", at: [0, 0], cells: { "0,0": ["1*16", "1*16", "1*4,2*8,1*4"] } },
    { id: "lamp", type: "lamp", at: [2, 1] },
    { id: "spot", type: "marker", at: [4, 1] },
  ],
};

let root: string;
let ctx: ToolContext;

/** The engine, platformer and card game projects, copied under `base`. */
async function projectsIn(base: string): Promise<ToolContext> {
  const dirs = {
    engine: join(base, "engine"),
    platformer: join(base, "platformer"),
    card: join(base, cardGame.id),
    walker: join(base, walkerGame.id),
    orchard: join(base, orchardGame.id),
    fountain: join(base, fountainGame.id),
    duel: join(base, duelGame.id),
    tactics: join(base, tacticsGame.id),
  };
  await cp(repoFile("src/engine/scenes"), dirs.engine, { recursive: true });
  await mkdir(dirs.platformer);
  await mkdir(dirs.card);
  await writeFile(join(dirs.card, "card-table.json"), formatScene(CARD_TABLE).text);
  await mkdir(dirs.walker);
  await writeFile(join(dirs.walker, "corridor.json"), formatScene(corridor).text);
  await mkdir(dirs.orchard);
  await writeFile(join(dirs.orchard, "meadow.json"), formatScene(meadow).text);
  await mkdir(dirs.fountain);
  await writeFile(join(dirs.fountain, "basin.json"), formatScene(basin).text);
  await writeFile(join(dirs.fountain, "twin-spout.json"), formatPrefab(twinSpout));
  await mkdir(dirs.duel);
  await writeFile(join(dirs.duel, "field.json"), formatScene(field).text);
  await copyFile(
    repoFile("scripts/scene/examples/duel.input-map.json"),
    join(dirs.duel, "input-map.json"),
  );
  await cp(repoFile("src/games/tactics"), dirs.tactics, {
    recursive: true,
    filter: (src) => !src.includes("__tests__"),
  });
  await copyFile(
    repoFile("src/games/platformer/scenes/test-yard.json"),
    join(dirs.platformer, "test-yard.json"),
  );
  return {
    projects: [
      await tempProject(dirs.engine, { id: "engine" }),
      await tempProject(dirs.platformer, { game: platformerGame }),
      await tempProject(dirs.card, { game: cardGame }),
      await tempProject(dirs.walker, { game: walkerGame }),
      await tempProject(dirs.orchard, { game: orchardGame }),
      await tempProject(dirs.fountain, { game: fountainGame }),
      await tempProject(dirs.duel, { game: duelGame }),
      await openProject(dirs.tactics, {
        game: tacticsGame,
        cacheDir: join(base, ".jams-cache", tacticsGame.id),
      }),
    ],
    loadRapier: loadCompatRapier,
  };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-readme-"));
  ctx = await projectsIn(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const texts = await Promise.all(DOCS.map((doc) => readFile(repoFile(doc), "utf8")));
const all = DOCS.map((doc, i) => examples(doc, texts[i]!));
const allBatches = DOCS.flatMap((doc, i) => batches(doc, texts[i]!));

describe("scene commands in the docs", () => {
  it("finds the README's fenced examples and its inline commands", () => {
    const [readme] = all;
    expect(readme!.filter((e) => e.fenced).length).toBeGreaterThan(10);
    expect(readme!.filter((e) => !e.fenced).length).toBeGreaterThan(0);
  });

  for (const example of all.flat()) {
    const [name, rest] = split(example.argv);
    if (!name || placeholder(name)) continue;

    it(`${example.doc}: ${example.line} names a real command and real flags`, () => {
      expect(Object.hasOwn(COMMANDS, name), `unknown command ${name}`).toBe(true);
      const command: { values: readonly string[]; switches: readonly string[] } =
        COMMANDS[name as CommandName];
      for (const arg of rest.filter((a) => a.startsWith("--"))) {
        const flag = arg.slice(2).split("=")[0]!;
        expect(
          flag === "json" || command.values.includes(flag) || command.switches.includes(flag),
          `${name} has no flag --${flag}`,
        ).toBe(true);
      }
    });

    if (example.fenced && isPure(example.argv) && !example.argv.some(placeholder)) {
      const { expect: code } = example;
      // `game new` imports and judges the game it generates.
      const timeout = name === "game new" ? 60_000 : undefined;
      it(
        `${example.doc}: ${example.line} ${code ? `reports ${code}` : "runs"}`,
        async () => {
          const r = await runCli(inRoot(example.argv), ctx);
          if (code) expect([...codesIn(JSON.parse(r.stdout))], r.stdout + r.stderr).toContain(code);
          else expect(r.exitCode, `${example.line}\n${r.stderr}`).toBe(0);
        },
        timeout,
      );
    }
  }
});

describe("op batches in the docs", () => {
  it("finds the README's batches", () => {
    expect(allBatches.filter((b) => b.doc === DOCS[0]).length).toBeGreaterThan(10);
  });

  for (const [n, b] of allBatches.entries()) {
    const on =
      "scene" in b.target
        ? b.target.scene
        : "checks" in b.target
          ? `checks of ${b.target.checks}`
          : `project ${b.target.project}`;
    const outcome = b.expect ? `reports ${b.expect}` : "applies";
    it(`${b.doc}:${b.line}: the batch on ${on} ${outcome}`, async () => {
      const file = join(root, `batch-${n}.json`);
      await writeFile(file, b.text);
      const argv =
        "scene" in b.target
          ? ["apply", b.target.scene, "--ops", file, "--dry-run", "--json"]
          : "checks" in b.target
            ? ["check", b.target.checks, "--checks", file, "--json"]
            : [
                "assets",
                "apply",
                "--ops",
                file,
                "--project",
                b.target.project,
                "--dry-run",
                "--json",
              ];
      const r = await runCli(argv, ctx);
      const codes = codesIn(JSON.parse(r.stdout));
      if (b.expect) expect([...codes], r.stdout).toContain(b.expect);
      else expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    });
  }

  /** The ops a runnable example uses: its batches', and those of the example files its commands apply. */
  async function opsInRunnableExamples(): Promise<Set<string>> {
    const texts = allBatches.filter((b) => !b.expect).map((b) => b.text);
    for (const e of all.flat()) {
      if (!e.fenced || !isPure(e.argv)) continue;
      const i = e.argv.indexOf("--ops");
      const file = i >= 0 ? e.argv[i + 1] : undefined;
      if (file?.startsWith("scripts/scene/examples/"))
        texts.push(await readFile(repoFile(file), "utf8"));
    }
    return new Set(
      texts.flatMap((t) => [...t.matchAll(/"op":\s*"([A-Za-z]+)"/g)].map((m) => m[1]!)),
    );
  }

  it("shows every op format v3 added or changed in an example that runs", async () => {
    const used = await opsInRunnableExamples();
    expect(V3_OPS.filter((op) => !used.has(op))).toEqual([]);
  });

  it("reproduces every issue code sprites added, and lists each in the issue table", () => {
    const expected = new Set(allBatches.map((b) => b.expect));
    expect(SPRITE_CODES.filter((code) => !expected.has(code))).toEqual([]);
    for (const code of SPRITE_CODES)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
  });

  it("runs every command sprites added in an example", () => {
    const run = new Set(
      all
        .flat()
        .filter((e) => e.fenced && isPure(e.argv))
        .map((e) => split(e.argv)[0]),
    );
    expect(SPRITE_COMMANDS.filter((name) => !run.has(name))).toEqual([]);
  });

  it("reproduces every issue code the world models added, and lists each in the issue table", () => {
    const expected = new Set([
      ...allBatches.map((b) => b.expect),
      ...all.flat().map((e) => e.expect),
    ]);
    expect(WORLD_CODES.filter((code) => !expected.has(code))).toEqual([]);
    for (const code of WORLD_CODES)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
  });

  it("runs every command and flag the world models added in an example", () => {
    const run = all.flat().filter((e) => e.fenced && isPure(e.argv));
    const used = (name: string, flag?: string) =>
      run.some((e) => split(e.argv)[0] === name && (!flag || e.argv.includes(flag)));
    expect(used("grid", "--from")).toBe(true);
    expect(used("grid", "--fov")).toBe(true);
    expect(used("step", "--command")).toBe(true);
    expect(used("step", "--elapse")).toBe(true);
    expect(used("check", "--checks")).toBe(true);
  });

  it("reproduces every issue code lifecycle added, and lists each in the issue table", () => {
    const expected = new Set(all.flat().map((e) => e.expect));
    expect(LIFECYCLE_CODES.filter((code) => !expected.has(code))).toEqual([]);
    for (const code of LIFECYCLE_CODES)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
  });

  it("lists every lifecycle event, and runs the lifecycle flags, predicates and expect", async () => {
    for (const type of LIFECYCLE_EVENTS)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${type}\` +\\|`, "m"));
    const run = all.flat().filter((e) => e.fenced && isPure(e.argv) && !e.expect);
    const used = (name: string, flag: string) =>
      run.some((e) => split(e.argv)[0] === name && e.argv.includes(flag));
    expect(used("step", "--events")).toBe(true);
    expect(used("playtest", "--events")).toBe(true);
    const files = async (name: string, flag: string) =>
      Promise.all(
        run
          .filter((e) => split(e.argv)[0] === name)
          .map((e) => e.argv[e.argv.indexOf(flag) + 1])
          .filter((f): f is string => !!f?.startsWith("scripts/scene/examples/"))
          .map((f) => readFile(repoFile(f), "utf8")),
      );
    type Steps = { until?: object }[];
    const scripts = (await files("playtest", "--script")).map((t) => JSON.parse(t));
    const until = scripts.flatMap((s: { steps?: Steps; tracks?: { steps: Steps }[] }) =>
      [s.steps ?? [], ...(s.tracks ?? []).map((t) => t.steps)]
        .flat()
        .flatMap((st) => (st.until ? [st.until] : [])),
    );
    expect(until.some((u) => "exists" in u)).toBe(true);
    expect(until.some((u) => "count" in u)).toBe(true);
    const checks = (await files("check", "--checks")).map((t) => JSON.parse(t));
    expect(
      checks.some((c: { checks: { kind: string; expect?: object }[] }) =>
        c.checks.some((k) => k.kind === "reaches" && k.expect),
      ),
    ).toBe(true);
  });

  it("reproduces every issue code format v3 added, and lists each in the issue table", () => {
    const expected = new Set(allBatches.map((b) => b.expect));
    expect(V3_CODES.filter((code) => !expected.has(code))).toEqual([]);
    const readme = texts[0]!;
    for (const code of V3_CODES) expect(readme).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
  });

  it("reproduces the input codes, lists all three in the issue table, and runs input v2's commands", async () => {
    const expected = new Set([
      ...allBatches.map((b) => b.expect),
      ...all.flat().map((e) => e.expect),
    ]);
    expect(INPUT_CODES.filter((code) => !expected.has(code))).toEqual([]);
    for (const code of INPUT_LISTED)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
    const run = all.flat().filter((e) => e.fenced && isPure(e.argv) && !e.expect);
    const used = (name: string, flag?: string, value?: string) =>
      run.filter(
        (e) =>
          split(e.argv)[0] === name &&
          (!flag || e.argv.includes(flag)) &&
          (!value || e.argv.some((a) => a.includes(value))),
      );
    expect(used("input").length).toBeGreaterThan(0);
    expect(used("input", "--player").length).toBeGreaterThan(0);
    expect(used("replay", "--run", ".v1.").length).toBeGreaterThan(0);
    const scripts = await Promise.all(
      used("playtest", "--script").map((e) =>
        readFile(repoFile(e.argv[e.argv.indexOf("--script") + 1]!), "utf8").then(
          (t) => JSON.parse(t) as { v: number; tracks?: { steps: Record<string, unknown>[] }[] },
        ),
      ),
    );
    const v2 = scripts.filter((s) => s.v === 2 && (s.tracks?.length ?? 0) > 1);
    expect(v2.length).toBeGreaterThan(0);
    const kinds = new Set(
      v2.flatMap((s) => s.tracks!.flatMap((t) => t.steps.flatMap(Object.keys))),
    );
    for (const kind of ["set", "pointer", "join", "leave"]) expect(kinds).toContain(kind);
  });

  it("runs game new for every preset and flag, step --legal, and a command game's playtest and fuzz", () => {
    const run = all.flat().filter((e) => e.fenced && isPure(e.argv) && !e.expect);
    const used = (name: string, flag?: string, value?: string) =>
      run.some(
        (e) =>
          split(e.argv)[0] === name &&
          (!flag || e.argv.includes(flag)) &&
          (!value || e.argv[e.argv.indexOf(flag!) + 1] === value),
      );
    const games = run.filter((e) => split(e.argv)[0] === "game new");
    for (const preset of GAME_PRESETS.filter((p) => p !== "top-down"))
      expect(used("game new", "--preset", preset), preset).toBe(true);
    expect(
      games.some((e) => !e.argv.includes("--preset")),
      "the default preset",
    ).toBe(true);
    for (const flag of ["--physics", "--gravity", "--rate", "--cell", "--px-per-metre", "--json"])
      expect(used("game new", flag), flag).toBe(true);
    expect(used("step", "--legal")).toBe(true);
    const onLevel = (name: string) =>
      run.some((e) => split(e.argv)[0] === name && e.argv[1] === "level-1");
    expect(onLevel("step") && onLevel("playtest") && onLevel("fuzz")).toBe(true);
    expect(allBatches.some((b) => "scene" in b.target && b.target.scene === "level-1")).toBe(true);
  });

  it("reproduces project-id-taken and a bad id, and lists project-id-taken", () => {
    const expected = all
      .flat()
      .filter((e) => split(e.argv)[0] === "game new")
      .map((e) => e.expect);
    expect(GAME_NEW_CODES.filter((code) => !expected.includes(code))).toEqual([]);
    expect(expected).toContain("schema");
    for (const code of GAME_NEW_CODES)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
  });

  it("reproduces a px-sized op landing out of bounds, and lists migration-unresolved", () => {
    const expected = new Set(allBatches.map((b) => b.expect));
    expect(UNITS_CODES.filter((code) => !expected.has(code))).toEqual([]);
    for (const code of UNITS_LISTED)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
  });
  it("reproduces the flow and save codes the CLI can, and lists all eight in the issue table", () => {
    const expected = new Set([
      ...allBatches.map((b) => b.expect),
      ...all.flat().map((e) => e.expect),
    ]);
    expect(FLOW_CODES.filter((code) => !expected.has(code))).toEqual([]);
    for (const code of FLOW_LISTED)
      expect(texts[0]!).toMatch(new RegExp(`^\\| \`${code}\` +\\|`, "m"));
  });

  it("runs every flow and save command and flag, and the scene and persist predicates", async () => {
    const run = all.flat().filter((e) => e.fenced && isPure(e.argv) && !e.expect);
    const used = (name: string, flag?: string, value?: string) =>
      run.filter(
        (e) =>
          split(e.argv)[0] === name &&
          (!flag || e.argv.includes(flag)) &&
          (!value || e.argv[e.argv.indexOf(flag!) + 1] === value),
      );
    expect(used("flow").length).toBeGreaterThan(0);
    expect(used("flow", "--project", "tactics").length).toBeGreaterThan(0);
    expect(used("playtest", "--flow").length).toBeGreaterThan(0);
    expect(used("playtest", "--from-save").length).toBeGreaterThan(0);
    expect(used("fuzz", "--from-save").length).toBeGreaterThan(0);
    expect(used("save").length).toBeGreaterThan(0);
    expect(used("save", "--depth", "progress").length).toBeGreaterThan(0);

    // The save the from-save runs start from is one an earlier example wrote.
    const outs = used("save").map((e) => e.argv[e.argv.indexOf("--out") + 1]);
    for (const e of [...used("playtest", "--from-save"), ...used("fuzz", "--from-save")])
      expect(outs).toContain(e.argv[e.argv.indexOf("--from-save") + 1]);

    const until = (
      await Promise.all(
        used("playtest", "--flow").map((e) =>
          readFile(repoFile(e.argv[e.argv.indexOf("--script") + 1]!), "utf8"),
        ),
      )
    ).flatMap((t) =>
      (JSON.parse(t) as { steps: { until?: object }[] }).steps.flatMap((s) =>
        s.until ? [s.until] : [],
      ),
    );
    expect(until.some((u) => "scene" in u)).toBe(true);
    expect(until.some((u) => "persist" in u)).toBe(true);
  });

  it("edits a scene list in a batch that applies", async () => {
    const texts = allBatches.filter((b) => !b.expect).map((b) => b.text);
    for (const e of all.flat()) {
      if (!e.fenced || !isPure(e.argv) || e.expect || split(e.argv)[0] !== "assets apply") continue;
      texts.push(await readFile(repoFile(e.argv[e.argv.indexOf("--ops") + 1]!), "utf8"));
    }
    const edits = texts.flatMap(
      (t) => (JSON.parse(t) as { ops: { op: string; id?: string }[] }).ops,
    );
    expect(edits).toContainEqual(expect.objectContaining({ op: "editAsset", id: "scene-list" }));
  });

  it("documents every flow and save flag in the commands table", () => {
    const table = texts[0]!.slice(
      texts[0]!.indexOf("## Commands"),
      texts[0]!.indexOf("## Projects and assets"),
    );
    for (const name of ["flow", "playtest", "fuzz", "save"] as const) {
      const row = table
        .split("\n")
        .find((l) => l.startsWith(`| \`${name} `) || l.startsWith(`| \`${name}\``));
      expect(row, name).toBeDefined();
      const { values, switches }: { values: readonly string[]; switches: readonly string[] } =
        COMMANDS[name];
      // Every command takes `--project`, which the README says once.
      for (const flag of [...values, ...switches].filter((f) => f !== "project"))
        expect(row, `${name} --${flag}`).toContain(`--${flag}`);
    }
  });

  it("lists scene_flow and the playtest tool's flow and fromSave in the MCP table", () => {
    const row = (tool: string) =>
      texts[0]!.split("\n").find((l) => l.startsWith(`| \`${tool}\``)) ?? "";
    expect(row("scene_flow")).toContain("`flow`");
    expect(row("scene_playtest")).toContain("`flow`");
    expect(row("scene_playtest")).toContain("`fromSave`");
    expect(row("asset_apply_ops")).toContain("scene lists");
  });
});
