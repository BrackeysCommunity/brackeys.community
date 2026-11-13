import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { tickRateProblem, type GameDefinition } from "@jams/engine/game";
import {
  createRegistry,
  createScene,
  formatScene,
  ID_PATTERN,
  inputScriptJsonSchema,
  makeIssue,
  parseChecks,
  parseInputScript,
  parseScene,
  pointerLines,
  sceneJsonSchema,
  validateScene,
  type Registry,
  type SceneIssue,
} from "@jams/engine/scene";

import { failure, issueLine, usage, type Tool, type ToolContext } from "../context";
import {
  GAME_PRESETS,
  gameNames,
  generatedJson,
  onBehaviors,
  PRESET_OPTIONS,
  renderSources,
  titleOf,
  type GameFile,
  type GameOptions,
  type GamePreset,
} from "../game-templates";
import { projectFile, projectIdTaken } from "../game-templates/project";
import { parsePoint } from "./playtest";

/** `game new`'s flags after the id. */
export const GAME_NEW_FLAGS =
  '[--name "Title"] [--preset top-down|side-view|grid|turns] [--physics none|rapier] [--gravity x,y] [--time fixed|turns|event] [--rate n] [--grid square|hex|none] [--cell n] [--px-per-metre n] [--dir src/games] [--dry-run]';

const USAGE = `game new <id> ${GAME_NEW_FLAGS}`;

export type GameNewInput = {
  /** The new project's id (`ID_PATTERN`), also its directory name under `dir`. */
  id?: string;
  /** The project's display name. */
  name?: string;
  /** `top-down` (default), `side-view`, `grid` or `turns`. */
  preset?: string;
  /** `none` or `rapier`, over the preset's. */
  physics?: string;
  /** `x,y` in m/s², over the preset's. */
  gravity?: string;
  /** `fixed`, `turns` or `event`, over the preset's. */
  time?: string;
  /** Ticks per second, over the preset's. */
  rate?: string;
  /** `square`, `hex` or `none`, over the preset's. */
  grid?: string;
  /** The grid cell's size in metres, over the preset's. */
  cell?: string;
  /** The game's px per metre (`world.lengthUnit`), over the preset's. */
  pxPerMetre?: string;
  /** Where the project's directory goes; default `src/games`. */
  dir?: string;
  /** List the files without writing them. */
  dryRun?: boolean;
};

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/** Where a game is written to be imported and judged before anything lands in `--dir`: gitignored, and inside the repo so its imports resolve. */
export const GAME_NEW_STAGE = join(REPO_ROOT, "node_modules", ".game-new");
const ENGINE_DIR = join(REPO_ROOT, "packages", "engine");
const DEFAULT_DIR = "src/games";

const TIME_KINDS = ["fixed", "turns", "event"] as const;

const positive = (text: string): number | null => {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/** The game's options: the preset's, each flag over it; a usage error for a flag it can't take. */
export function gameOptionsFrom(id: string, input: GameNewInput): GameOptions | string {
  const preset = (input.preset ?? "top-down") as GamePreset;
  if (!GAME_PRESETS.includes(preset))
    return `--preset takes ${GAME_PRESETS.join(", ")}; got ${JSON.stringify(input.preset)}`;
  const base = PRESET_OPTIONS[preset];
  const options: GameOptions = {
    ...structuredClone(base),
    id,
    name: input.name ?? titleOf(id),
  };
  if (options.name.trim() === "") return "--name can't be empty";

  if (input.physics !== undefined) {
    if (input.physics !== "none" && input.physics !== "rapier")
      return `--physics takes none or rapier; got ${JSON.stringify(input.physics)}`;
    options.physics = input.physics;
  }
  if (input.gravity !== undefined) {
    const g = parsePoint(input.gravity);
    if (!g) return "--gravity takes x,y in m/s², e.g. --gravity 0,9.8";
    options.gravity = g;
  }
  if (input.time !== undefined) {
    const kind = input.time as (typeof TIME_KINDS)[number];
    if (!TIME_KINDS.includes(kind))
      return `--time takes ${TIME_KINDS.join(", ")}; got ${JSON.stringify(input.time)}`;
    if (kind === "turns" && preset !== "turns")
      return `--time turns: the ${preset} preset moves on actions, which a turns clock never ticks for; use --preset turns`;
    options.time.kind = kind;
  }
  if (input.rate !== undefined) {
    const rate = Number(input.rate);
    const problem = tickRateProblem(input.rate.trim() === "" ? Number.NaN : rate);
    if (problem) return `--rate: ${problem}`;
    options.time.rate = rate;
  }
  if (input.grid !== undefined) {
    if (input.grid !== "square" && input.grid !== "hex" && input.grid !== "none")
      return `--grid takes square, hex or none; got ${JSON.stringify(input.grid)}`;
    if (!onBehaviors(options) && input.grid !== "square")
      return `--grid ${input.grid}: the ${preset} preset steps on a square grid`;
    options.grid =
      input.grid === "none" ? null : { kind: input.grid, cell: options.grid?.cell ?? 1 };
  }
  if (input.cell !== undefined) {
    const cell = positive(input.cell);
    if (cell === null) return "--cell takes the cell's size in metres, a number above 0";
    if (!options.grid) return "--cell needs a grid: add --grid square or --grid hex";
    options.grid.cell = cell;
  }
  if (input.pxPerMetre !== undefined) {
    const ppm = positive(input.pxPerMetre);
    if (ppm === null) return "--px-per-metre takes a number above 0";
    options.lengthUnit = ppm;
  }
  return options;
}

/** The new project file's text, for the line `project-id-taken` and `schema` point at. */
const projectText = (options: GameOptions, projectDir: string) =>
  projectFile(
    options,
    gameNames(options.id),
    relative(projectDir, join(ENGINE_DIR, "project/project.schema.json")).split(sep).join("/"),
  );

/** `projectIdTaken` over the context's discovered projects and the disk: the one check the CLI and MCP make. */
export function checkProjectId(
  ctx: Pick<ToolContext, "projects">,
  options: GameOptions,
  projectDir: string,
): SceneIssue | null {
  return projectIdTaken(
    options.id,
    projectDir,
    { projects: ctx.projects, dirExists: existsSync(projectDir) },
    projectText(options, projectDir),
  );
}

/** What `planGame` gives: every file, and the issues of its scene, checks and script. */
export type GamePlan = { files: GameFile[]; issues: SceneIssue[] };

/** A checks or script issue as a scene issue of `code`, keeping its pointer, line and hint. */
const docIssue = (
  file: string,
  i: {
    path: string;
    message: string;
    line?: number;
    hint?: string;
    expected?: string;
    got?: string;
  },
): SceneIssue =>
  makeIssue("schema", {
    message: `${file}: ${i.message}`,
    path: i.path,
    ...(i.line === undefined ? {} : { line: i.line }),
    ...(i.hint === undefined ? {} : { hint: i.hint }),
    ...(i.expected === undefined ? {} : { expected: i.expected }),
    ...(i.got === undefined ? {} : { got: i.got }),
  });

/**
 * Every file of the game `options` describes, for `projectDir`: the
 * templates' sources (the scene list `scene-list.json`, starting at `main`,
 * among them), then what only the game itself can give. The sources
 * are written to a stage under `node_modules/.game-new/`, the game module
 * is imported from there and its registry builds the scene schema, the
 * input-script schema and `scenes/main.json` (the game's template, through
 * `createScene`). Issues are the scene's, the checks file's and the
 * script's. The stage is removed; `projectDir` is never touched.
 */
export async function planGame(options: GameOptions, projectDir: string): Promise<GamePlan> {
  const sources = renderSources(options, { projectDir, engineDir: ENGINE_DIR });
  await mkdir(GAME_NEW_STAGE, { recursive: true });
  const stage = await mkdtemp(join(GAME_NEW_STAGE, "stage-"));
  try {
    const dir = join(stage, options.id);
    await writeFiles(dir, sources);
    const names = gameNames(options.id);
    const module = (await import(pathToFileURL(join(dir, "index.ts")).href)) as Record<
      string,
      unknown
    >;
    const game = module[names.gameExport] as GameDefinition | undefined;
    if (!game) throw new Error(`index.ts has no ${names.gameExport} export`);
    const registry: Registry = createRegistry(game);

    const def = createScene("main", registry, { $schema: "../scene.schema.json" });
    const sceneText = formatScene(def).text;
    const parsed = parseScene(sceneText, registry);
    const issues: SceneIssue[] = parsed.ok
      ? validateScene(parsed.def, registry, { lines: formatScene(parsed.def).lines })
      : [...parsed.issues];
    const text = (path: string) => sources.find((f) => f.path === path)!.text;
    const checks = parseChecks(text("scenes/main.checks.json"), registry);
    if (!checks.ok) issues.push(...checks.issues.map((i) => docIssue("main.checks.json", i)));
    const script = parseInputScript(text("scenes/main.script.json"), registry);
    if (!script.ok) issues.push(...script.issues.map((i) => docIssue("main.script.json", i)));

    const files = [
      ...sources,
      { path: "scene.schema.json", text: generatedJson(sceneJsonSchema(registry)) },
      {
        path: "input-script.schema.json",
        text: generatedJson(inputScriptJsonSchema(registry)),
      },
      { path: "scenes/main.json", text: sceneText },
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { files, issues };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function writeFiles(dir: string, files: readonly GameFile[]): Promise<void> {
  for (const f of files) {
    const path = join(dir, ...f.path.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, f.text);
  }
}

const shown = (path: string) => {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel.split(sep).join("/");
};

/**
 * Writes a new game project from a preset into `<dir>/<id>/`: the project
 * file, the game and UI modules, one scene with checks and a winning input
 * script, a scene list (`scene-list.json`) listing that scene as its start,
 * a game-settings and an input-map doc, the generated schemas and a test. Refused, with nothing written, for an id outside `ID_PATTERN`
 * (`schema`), an id a discovered project holds or a directory that exists
 * (`project-id-taken`), and a scene with error issues. `--dry-run` lists
 * the files and writes none.
 */
export const gameNew: Tool<GameNewInput> = async (input, ctx) => {
  const { id } = input;
  if (!id) return usage(USAGE);
  const dir = resolve(input.dir ?? DEFAULT_DIR);
  const projectDir = join(dir, id);

  const options = gameOptionsFrom(id, input);
  if (typeof options === "string") return usage(`${USAGE}: ${options}`);
  if (!ID_PATTERN.test(id)) {
    const issue = makeIssue("schema", {
      message: `project id ${JSON.stringify(id)} must match ${ID_PATTERN}`,
      path: "/id",
      line: pointerLines(projectText(options, projectDir)).get("/id"),
      expected: String(ID_PATTERN),
      got: JSON.stringify(id),
    });
    return refused(id, projectDir, [issue]);
  }
  const taken = checkProjectId(ctx, options, projectDir);
  if (taken) return refused(id, projectDir, [taken]);

  let plan: GamePlan;
  try {
    plan = await planGame(options, projectDir);
  } catch (e) {
    return failure(`${id}: the generated game doesn't load: ${(e as Error).message}`);
  }
  const errors = plan.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) return refused(id, projectDir, plan.issues);

  const dryRun = input.dryRun === true;
  if (!dryRun) await writeFiles(projectDir, plan.files);
  const paths = plan.files.map((f) => join(projectDir, ...f.path.split("/")));
  const play = `/game/dev?game=${id}`;
  const playtest = `vp run scene playtest main --project ${id} --script ${shown(join(projectDir, "scenes", "main.script.json"))}`;
  const hosted = resolve(REPO_ROOT, DEFAULT_DIR) === dir;
  const g = options.grid ? `, ${options.grid.kind} grid ${options.grid.cell} m` : "";
  return {
    exitCode: 0,
    data: {
      ok: true,
      id,
      dir: projectDir,
      options,
      dryRun,
      written: !dryRun,
      files: paths,
      issues: plan.issues,
      urls: { play, edit: `/game/dev?edit=1&project=${id}` },
      playtest,
    },
    text: [
      `${id}: ${dryRun ? "would create" : "created"} ${shown(projectDir)} (${options.preset}, physics ${options.physics}, time ${options.time.kind} ${options.time.rate}${g}, ${options.lengthUnit} px per metre)`,
      ...paths.map((p) => `  ${shown(p)}`),
      ...plan.issues.map(issueLine),
      `play:     ${play}`,
      `edit:     /game/dev?edit=1&project=${id}`,
      `playtest: ${playtest}`,
      ...(hosted ? [] : [`note: the site hosts games under ${DEFAULT_DIR} only`]),
    ].join("\n"),
  };
};

function refused(id: string, projectDir: string, issues: SceneIssue[]) {
  return {
    exitCode: 1 as const,
    data: { ok: false, id, dir: projectDir, written: false, files: [], issues },
    text: [`${id}: not created`, ...issues.map(issueLine)].join("\n"),
  };
}
