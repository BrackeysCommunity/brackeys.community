import { execFile } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { ENGINE_REGISTRY_ID } from "@jams/engine/game";
import type { RapierModule } from "@jams/engine/headless";
import type { ProjectId } from "@jams/engine/project";
import {
  closest,
  createRegistry,
  makeIssue,
  parseScene,
  sceneGameOf,
  type PrefabLibrary,
  type Registry,
  type SceneDefinition,
  type SceneIssue,
} from "@jams/engine/scene";
import {
  readPrefabFiles,
  readProjectPrefabFiles,
  SCENE_NAME_PATTERN,
  type PrefabFiles,
  type ProjectScan,
} from "@jams/engine/vite";

import {
  locateInProjects,
  projectById,
  scanProject,
  unknownProjectMessage,
  type ProjectHandle,
} from "./projects";

const run = promisify(execFile);

export type ToolContext = {
  /** The projects scene and asset names resolve in; a scene's `game` key picks the registry of the project whose game it names. */
  projects: readonly ProjectHandle[];
  /** `--project`: names resolve in this project only. */
  project?: ProjectId;
  /** Each project's scene JSON Schema file, for the `$schema` that `new` writes; a project without one copies its other scenes'. */
  schemaFiles?: Readonly<Record<ProjectId, string>>;
  loadRapier: () => Promise<RapierModule>;
  /** Reads `-` arguments; the CLI passes stdin. */
  readStdin?: () => Promise<string>;
  /** A file's text at a git revision; defaults to `git show <rev>:./<file>` beside the file. */
  gitShow?: (file: string, rev: string) => Promise<string>;
  /** Where hosted calls read `JAMS_AGENT_TOKEN`; `process.env` by default. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The HTTP client hosted calls use; the global `fetch` by default. */
  fetch?: typeof fetch;
};

/** What a live call passes on to `openLiveProject` for a hosted project. */
export function hostedOptions(ctx: Pick<ToolContext, "env" | "fetch">, token: string | undefined) {
  return {
    ...(token === undefined ? {} : { token }),
    ...(ctx.env ? { env: ctx.env } : {}),
    ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
  };
}

/** `git show <rev>:./<name>`, run in the file's own directory. */
export async function gitShow(file: string, rev: string): Promise<string> {
  const { stdout } = await run("git", ["show", `${rev}:./${basename(file)}`], {
    cwd: dirname(file),
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

/** 0 ok, 1 error-severity issues or failure, 2 usage, 3 stale base. */
export type ExitCode = 0 | 1 | 2 | 3;

export type ToolResult = { exitCode: ExitCode; data: unknown; text: string };

export type Tool<I> = (input: I, ctx: ToolContext) => Promise<ToolResult>;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export const usage = (message: string): ToolResult => ({
  exitCode: 2,
  data: { ok: false, error: message },
  text: `usage: ${message}`,
});

export const failure = (message: string, extra: Record<string, unknown> = {}): ToolResult => ({
  exitCode: 1,
  data: { ok: false, error: message, ...extra },
  text: `error: ${message}`,
});

export const isToolResult = (v: unknown): v is ToolResult =>
  typeof v === "object" && v !== null && "exitCode" in v;

// ─── Projects in scope ───────────────────────────────────

/** The projects names resolve in: the `--project` one, else all of them. */
export function inScope(ctx: Pick<ToolContext, "projects" | "project">): readonly ProjectHandle[] {
  if (ctx.project === undefined) return ctx.projects;
  const named = projectById(ctx.projects, ctx.project);
  return named ? [named] : [];
}

/** A usage error when `--project` names no project; null otherwise. */
export function scopeError(ctx: ToolContext): ToolResult | null {
  if (ctx.project === undefined || projectById(ctx.projects, ctx.project)) return null;
  const guess = closest(
    ctx.project,
    ctx.projects.map((p) => p.file.id),
  );
  return usage(
    `${unknownProjectMessage(ctx.projects, ctx.project)}${guess ? `; did you mean "${guess}"?` : ""}`,
  );
}

/** The project whose directory holds `file` (the innermost one); null for a file outside every project. */
export function projectOfFile(ctx: ToolContext, file: string): ProjectHandle | null {
  const abs = resolve(file);
  let best: ProjectHandle | null = null;
  for (const p of ctx.projects) {
    const rel = relative(p.dir, abs);
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
    if (!best || p.dir.length > best.dir.length) best = p;
  }
  return best;
}

// ─── Registries ──────────────────────────────────────────

let engineRegistry: Registry | undefined;

/**
 * What a scene without a `game` key is judged by: its project's primitives
 * (the engine project's registry, materials included), else the engine
 * project's, else the engine's alone.
 */
export function gamelessRegistry(ctx: ToolContext, project?: ProjectHandle | null): Registry {
  if (project) return project.registry.primitives;
  const engine = projectById(ctx.projects, ENGINE_REGISTRY_ID);
  if (engine && !engine.game) return engine.registry;
  return (engineRegistry ??= createRegistry());
}

/**
 * The registry for game `id`: `project`'s when it is that project's game,
 * else the registry of the project whose game it is; the gameless one for
 * `undefined`; null for a game no project has.
 */
export function registryOf(
  ctx: ToolContext,
  id: string | undefined,
  project?: ProjectHandle | null,
): Registry | null {
  if (id === undefined) return gamelessRegistry(ctx, project);
  if (project?.game?.id === id) return project.registry;
  return ctx.projects.find((p) => p.game?.id === id)?.registry ?? null;
}

/** The ids of the games the projects hold, in the projects' order. */
export const gameIds = (ctx: ToolContext): string[] => [
  ...new Set(ctx.projects.flatMap((p) => (p.game ? [p.game.id] : []))),
];

function knownGames(ctx: ToolContext, id: string): string {
  const guess = closest(id, gameIds(ctx));
  const hint = guess ? `; did you mean "${guess}"?` : "";
  return `${hint} (games: ${gameIds(ctx).join(", ") || "none"})`;
}

function unknownGame(ctx: ToolContext, id: string): SceneIssue {
  return makeIssue("unknown-game", {
    message: `no game ${JSON.stringify(id)}${knownGames(ctx, id)}`,
    path: "/game",
    expected: gameIds(ctx)
      .map((g) => JSON.stringify(g))
      .join(" | "),
    got: JSON.stringify(id),
  });
}

/** Resolves a `--game` flag; a usage error names the known games. */
export function gameFlag(ctx: ToolContext, id: string | undefined): Registry | ToolResult {
  const registry = registryOf(ctx, id);
  return registry ?? usage(`--game: no game ${JSON.stringify(id)}${knownGames(ctx, id!)}`);
}

/** The scene's `game` key, read from its text without validating it. */
function declaredGame(text: string): string | undefined {
  try {
    return sceneGameOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export type Judged =
  | { ok: true; game: string | undefined; registry: Registry }
  | { ok: false; game: string; issue: SceneIssue };

/**
 * The registry a scene is parsed, validated, edited and stepped with: its
 * game's, or the gameless one without a `game` key. `under` picks a game
 * for a scene that names none; `project` is the project the scene is in.
 */
export function judgeScene(
  ctx: ToolContext,
  text: string,
  under?: Registry,
  project?: ProjectHandle | null,
): Judged {
  const game = declaredGame(text);
  if (game === undefined)
    return { ok: true, game, registry: under ?? gamelessRegistry(ctx, project) };
  const registry = registryOf(ctx, game, project);
  return registry
    ? { ok: true, game, registry }
    : { ok: false, game, issue: unknownGame(ctx, game) };
}

// ─── Scene files ─────────────────────────────────────────

/** A scene asset: its id, the project holding it (`home` is that project's id) and its file. */
export type SceneFile = { name: string; home: ProjectId; file: string; project: ProjectHandle };

const SCENE_KIND = "scene";

const byName = (a: SceneFile, b: SceneFile) =>
  a.name === b.name ? (a.home < b.home ? -1 : 1) : a.name < b.name ? -1 : 1;

/** A project's live scene assets, from a scan of its files. */
export async function projectScenes(project: ProjectHandle): Promise<SceneFile[]> {
  const { state } = await scanProject(project);
  return Object.values(state.assets)
    .filter((e) => e.kind === SCENE_KIND && e.deleted === undefined)
    .map((e) => ({
      name: e.id,
      home: project.file.id,
      file: join(project.dir, ...e.path.split("/")),
      project,
    }))
    .sort(byName);
}

/** Every scene of the projects in scope, by name then project. */
export async function listSceneFiles(ctx: ToolContext): Promise<SceneFile[]> {
  const found = await Promise.all(inScope(ctx).map(projectScenes));
  return found.flat().sort(byName);
}

/** Names more than one project, or file, holds. */
export function clashes(files: readonly SceneFile[]): Map<string, string[]> {
  const homes = new Map<string, string[]>();
  for (const f of files) homes.set(f.name, [...(homes.get(f.name) ?? []), f.home]);
  return new Map([...homes].filter(([, h]) => h.length > 1));
}

export type Located = { ok: true; scene: SceneFile } | { ok: false; result: ToolResult };

/**
 * Finds scene `name` in the projects in scope. A name two projects hold is
 * a usage error unless `--project` picks one; the name follows the dev
 * server's guard (lowercase letters, digits and dashes).
 */
export async function locateScene(ctx: ToolContext, name: string): Promise<Located> {
  if (!SCENE_NAME_PATTERN.test(name))
    return {
      ok: false,
      result: usage(`scene name ${JSON.stringify(name)} must match ${SCENE_NAME_PATTERN}`),
    };
  const scenes = new Map<ProjectHandle, SceneFile[]>();
  const found = await locateInProjects(
    ctx.projects,
    name,
    async (p) => {
      const hits = (await projectScenes(p)).filter((s) => s.name === name);
      scenes.set(p, hits);
      return hits.length > 0;
    },
    ctx.project,
  );
  if (!found.ok) {
    if (found.reason === "not-found")
      return { ok: false, result: failure(`No scene named ${JSON.stringify(name)}.`) };
    const projects = found.reason === "ambiguous" ? { projects: found.projects } : {};
    return {
      ok: false,
      result: { ...usage(found.message), data: { ok: false, error: found.message, ...projects } },
    };
  }
  const hits = scenes.get(found.project) ?? [];
  if (hits.length > 1)
    return {
      ok: false,
      result: failure(
        `Scene ${JSON.stringify(name)} is in more than one file of project "${found.project.file.id}": ${hits.map((h) => relative(found.project.dir, h.file)).join(", ")}.`,
      ),
    };
  return { ok: true, scene: hits[0]! };
}

export async function writeSceneText(scene: Pick<SceneFile, "file">, text: string): Promise<void> {
  const tmp = `${scene.file}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, scene.file);
}

/** A scene name reads from the projects; anything with a slash or `.json` is a file path, read-only. */
export function isFileArg(arg: string): boolean {
  return arg.includes("/") || arg.endsWith(".json");
}

export async function readArg(ctx: ToolContext, arg: string): Promise<string> {
  if (arg === "-") {
    if (!ctx.readStdin) throw new UsageError("stdin is not available here");
    return ctx.readStdin();
  }
  return readFile(arg, "utf8");
}

async function notFound(ctx: ToolContext, target: string): Promise<ToolResult> {
  const stem = target.endsWith(".json") && !target.includes("/") ? target.slice(0, -5) : null;
  const isScene = stem !== null && (await listSceneFiles(ctx)).some((f) => f.name === stem);
  return failure(
    isScene
      ? `Not found: ${target}. To read the scene, pass its name: ${stem}.`
      : `Not found: ${target}.`,
  );
}

export type SceneSource =
  | { ok: true; text: string; scene: SceneFile | null; project: ProjectHandle | null }
  | { ok: false; result: ToolResult };

/**
 * Where a scene's prefabs come from: the prefab assets of the project the
 * scene's file is in (`scene` is that file), `prefabs/` beside a file
 * outside every project, or none for stdin.
 */
export type PrefabHome = { project: ProjectHandle; scene: string } | { dir: string } | undefined;

/** The prefab home of a scene read by `readSource` from `arg`. */
export function prefabHomeOf(
  source: { scene: SceneFile | null; project: ProjectHandle | null },
  arg: string,
): PrefabHome {
  if (source.project) return { project: source.project, scene: source.scene?.file ?? resolve(arg) };
  return arg === "-" ? undefined : { dir: dirname(arg) };
}

/**
 * A scene name, or a file path or `-` (read-only: `scene` is null). A file
 * inside a project is judged as that project's.
 */
export async function readSource(ctx: ToolContext, arg: string): Promise<SceneSource> {
  if (isFileArg(arg) || arg === "-") {
    try {
      const text = await readArg(ctx, arg);
      return { ok: true, text, scene: null, project: arg === "-" ? null : projectOfFile(ctx, arg) };
    } catch (e) {
      if (e instanceof UsageError) return { ok: false, result: usage(e.message) };
      if ((e as { code?: string }).code === "ENOENT")
        return { ok: false, result: await notFound(ctx, arg) };
      throw e;
    }
  }
  const located = await locateScene(ctx, arg);
  if (!located.ok) return located;
  return {
    ok: true,
    text: await readFile(located.scene.file, "utf8"),
    scene: located.scene,
    project: located.scene.project,
  };
}

type Parsed = {
  name: string;
  text: string;
  def: SceneDefinition;
  registry: Registry;
  /** The scene's prefabs, read from `home`. */
  prefabs: PrefabLibrary;
  home: PrefabHome;
  /** The project the scene is in; null for stdin and files outside every project. */
  project: ProjectHandle | null;
};

/**
 * The prefabs of `home`, judged by `registry`. A project's are its live
 * prefab assets at their registry paths, from `scan` when given. A prefab
 * file that doesn't parse is left out; validating a scene that uses it then
 * reports `prefab-unknown`.
 */
export async function readScenePrefabs(
  home: PrefabHome,
  registry: Registry,
  scan?: ProjectScan,
): Promise<PrefabFiles> {
  if (home === undefined)
    return { prefabs: new Map(), texts: new Map(), files: new Map(), problems: [] };
  if ("dir" in home) return readPrefabFiles(home.dir, registry);
  const { project } = home;
  const { state } = scan ?? (await scanProject(project));
  return readProjectPrefabFiles(project, state, registry);
}

/** The prefab library of `home`; see `readScenePrefabs`. */
export async function prefabsOf(
  home: PrefabHome,
  registry: Registry,
  scan?: ProjectScan,
): Promise<PrefabLibrary> {
  return (await readScenePrefabs(home, registry, scan)).prefabs;
}

/**
 * Parses a scene with its game's registry. `under` is the game a scene
 * without a `game` key runs under; it is a usage error on a scene that
 * names another.
 */
async function parseWithGame(
  ctx: ToolContext,
  name: string,
  text: string,
  under: Registry | undefined,
  home: PrefabHome,
  project: ProjectHandle | null,
): Promise<({ ok: true } & Parsed) | { ok: false; result: ToolResult }> {
  const judged = judgeScene(ctx, text, under, project);
  if (!judged.ok) return { ok: false, result: issuesFailure(name, [judged.issue]) };
  if (under && judged.game !== undefined && judged.game !== under.id) {
    return {
      ok: false,
      result: usage(
        `--game ${under.id}: ${name} is for game "${judged.game}"; --game only picks a game for a scene without one`,
      ),
    };
  }
  const parsed = parseScene(text, judged.registry);
  if (!parsed.ok) return { ok: false, result: issuesFailure(name, parsed.issues) };
  const prefabs = await prefabsOf(home, judged.registry);
  const registry = judged.registry;
  return { ok: true, name, text, def: parsed.def, registry, prefabs, home, project };
}

/**
 * Parses scene text that came from somewhere other than a project's files
 * (a git revision); `home` is where its prefabs are read from.
 */
export function parseSceneText(
  ctx: ToolContext,
  name: string,
  text: string,
  home?: PrefabHome,
  project: ProjectHandle | null = null,
): Promise<({ ok: true } & Parsed) | { ok: false; result: ToolResult }> {
  return parseWithGame(ctx, name, text, undefined, home, project);
}

export type OpenedScene = ({ ok: true } & Parsed) | { ok: false; result: ToolResult };

/** Reads and parses a scene by name, file path or `-`, for commands that never write. */
export async function openScene(
  ctx: ToolContext,
  arg: string | undefined,
  cmd: string,
  under?: Registry,
): Promise<OpenedScene> {
  if (!arg) return { ok: false, result: usage(`scene ${cmd} <scene|file|->`) };
  const source = await readSource(ctx, arg);
  if (!source.ok) return source;
  return parseWithGame(ctx, arg, source.text, under, prefabHomeOf(source, arg), source.project);
}

export type LoadedScene =
  | ({ ok: true; scene: SceneFile } & Parsed)
  | { ok: false; result: ToolResult };

/** Reads and parses a scene by name, for commands that write it back. */
export async function loadScene(
  ctx: ToolContext,
  name: string | undefined,
  cmd: string,
): Promise<LoadedScene> {
  if (!name) return { ok: false, result: usage(`scene ${cmd} <scene>`) };
  if (isFileArg(name) || name === "-")
    return {
      ok: false,
      result: usage(`scene ${cmd} takes a scene name; file paths are read-only`),
    };
  const located = await locateScene(ctx, name);
  if (!located.ok) return located;
  const parsed = await parseWithGame(
    ctx,
    name,
    await readFile(located.scene.file, "utf8"),
    undefined,
    { project: located.scene.project, scene: located.scene.file },
    located.scene.project,
  );
  return parsed.ok ? { ...parsed, scene: located.scene } : parsed;
}

export function issuesFailure(scene: string, issues: SceneIssue[]): ToolResult {
  return {
    exitCode: 1,
    data: { ok: false, scene, issues },
    text: [`${scene}: failed to parse`, ...issues.map(issueLine)].join("\n"),
  };
}

export function issueLine(i: SceneIssue): string {
  const where = i.line !== undefined ? `:${i.line}` : "";
  const ids = i.entityIds.length > 0 ? ` [${i.entityIds.join(", ")}]` : "";
  const hint = i.hint ? `\n    hint: ${i.hint}` : "";
  return `  ${i.severity} ${i.code}${where}${ids} ${i.message}${hint}`;
}
